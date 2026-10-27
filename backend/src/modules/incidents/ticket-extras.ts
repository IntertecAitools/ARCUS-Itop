import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { itopDay } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";

/**
 * The fields the `arcus-incident-extras` iTop extension adds
 * (itop-extensions/arcus-incident-extras): `next_action_date` on Incident and
 * UserRequest, `major_incident` on Incident.
 *
 * Like the problem RCA fields they are not in the published CMDB schema, so
 * every generic screen keeps working on an iTop without the extension; this
 * class alone reads and writes them, straight through the (tenant-scoped)
 * client. The pending reason is iTop's own `pending_reason`.
 */

/** The ticket classes that can be put on hold with a next-action date. */
export const HOLDABLE_CLASSES = ["Incident", "UserRequest"] as const;
export type HoldableClass = (typeof HOLDABLE_CLASSES)[number];

export const isHoldable = (className: string): className is HoldableClass =>
  (HOLDABLE_CLASSES as readonly string[]).includes(className);

/** Why a ticket is on hold and when someone acts on it again. */
export interface PendingInfo {
  reason: string;
  /** `YYYY-MM-DD`, a day on iTop's clock. Absent when iTop has none. */
  nextActionDate?: string;
  /** The next-action date has passed and the ticket is still on hold. */
  overdue: boolean;
}

export interface TicketExtrasRow {
  /** Only while the ticket is on hold. */
  pending?: PendingInfo;
  /** Incidents only. */
  major?: boolean;
}

export interface HoldInput {
  reason: string;
  nextActionDate: string;
  /** Appended to the public log with the transition. */
  comment?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in `YYYY-MM-DD`, not just the shape of one. */
export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** iTop writes a date as `YYYY-MM-DD` (sometimes with a time); the day part. */
const dayOf = (value: unknown): string | undefined => {
  const text = str(value).slice(0, 10);
  return DAY.test(text) ? text : undefined;
};

export const extrasMissing = () =>
  new AppError(
    "conflict",
    "This iTop has no next-action date or major-incident fields: install the arcus-incident-extras " +
      'extension (backend/README.md, "Incidents").',
    { details: { reason: "extension_missing" } },
  );

/** How long a "the extension is missing" answer is trusted before asking iTop again. */
const MISSING_RECHECK_MS = 60_000;

export class TicketExtras {
  /** true, or the time a check found the fields missing. */
  private readonly known = new Map<HoldableClass, true | number>();

  constructor(
    private readonly client: ItopClient,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Today on iTop's clock, the day a next-action date is compared with. */
  today(): string {
    return itopDay(this.now(), this.timeZone);
  }

  /**
   * Whether this iTop has the extension's fields on `className`. An OQL
   * naming an attribute the class lacks is refused, so a query that can
   * match nothing answers the question in one cheap call. A "yes" is kept;
   * a "no" is asked again after a minute, so installing the extension needs
   * no BFF restart.
   */
  async available(className: HoldableClass): Promise<boolean> {
    const known = this.known.get(className);
    if (known === true) return true;
    if (typeof known === "number" && this.now().getTime() - known < MISSING_RECHECK_MS) return false;
    const result = await this.client.callRaw(
      "core/get",
      { class: className, key: `SELECT ${className} WHERE id = 0 AND next_action_date IS NULL`, output_fields: "id" },
      { asService: true },
    );
    if (result.code === 0) {
      this.known.set(className, true);
      return true;
    }
    this.known.set(className, this.now().getTime());
    return false;
  }

  /** The OQL condition for "on hold and past its next-action date". */
  overdueCondition(): string {
    return `status = 'pending' AND next_action_date < '${this.today()}'`;
  }

  /** The extras of each ticket, by id. Tickets not on hold get no `pending`. */
  async read(className: HoldableClass, ids: string[]): Promise<Map<string, TicketExtrasRow>> {
    const out = new Map<string, TicketExtrasRow>();
    const numeric = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
    if (numeric.length === 0) return out;

    const withExtras = await this.available(className);
    const fields = ["status", "pending_reason"];
    if (withExtras) fields.push("next_action_date");
    if (withExtras && className === "Incident") fields.push("major_incident");

    const result = await this.client.call("core/get", {
      class: className,
      key: `SELECT ${className} WHERE id IN (${numeric.join(",")})`,
      output_fields: fields.join(","),
    });
    for (const row of normalizeObjects(result.objects)) {
      out.set(String(row.id), this.toRow(className, row.fields));
    }
    return out;
  }

  /** One ticket's extras, from fields already read (status, pending_reason, …). */
  toRow(className: HoldableClass, f: Record<string, unknown>): TicketExtrasRow {
    const row: TicketExtrasRow = {};
    if (str(f["status"]) === "pending") {
      const nextActionDate = dayOf(f["next_action_date"]);
      row.pending = {
        reason: str(f["pending_reason"]),
        ...(nextActionDate ? { nextActionDate } : {}),
        overdue: nextActionDate !== undefined && nextActionDate < this.today(),
      };
    }
    if (className === "Incident" && "major_incident" in f) {
      row.major = str(f["major_incident"]) === "yes";
    }
    return row;
  }

  /**
   * Puts a ticket on hold: iTop's `ev_pending` with its pending reason and
   * our next-action date. Both are required, and the date may not be in the
   * past: "act again yesterday" is a typo, not a plan.
   */
  async hold(className: HoldableClass, id: string, input: HoldInput): Promise<void> {
    const reason = input.reason.trim();
    if (!reason) throw badRequest("Say why the ticket is on hold.", { field: "pendingReason" });
    if (!isDay(input.nextActionDate)) {
      throw badRequest("The next-action date must be a day, YYYY-MM-DD.", { field: "nextActionDate" });
    }
    if (input.nextActionDate < this.today()) {
      throw badRequest("The next-action date cannot be in the past.", { field: "nextActionDate" });
    }
    if (!(await this.available(className))) throw extrasMissing();

    const fields: Record<string, unknown> = {
      pending_reason: reason,
      next_action_date: input.nextActionDate,
    };
    if (input.comment?.trim()) fields["public_log"] = input.comment.trim();

    const result = await this.client.call("core/apply_stimulus", {
      class: className,
      key: Number(id),
      stimulus: "ev_pending",
      fields,
      output_fields: "id",
      comment: "Put on hold via ARCUS",
    });
    if (normalizeObjects(result.objects).length === 0) throw notFound(`${className} ${id} was not found.`);
  }

  /** Flags an incident as major, or clears the flag. */
  async setMajor(id: string, major: boolean): Promise<void> {
    if (!(await this.available("Incident"))) throw extrasMissing();
    await this.client.call("core/update", {
      class: "Incident",
      key: Number(id),
      fields: { major_incident: major ? "yes" : "no" },
      output_fields: "id",
      comment: major ? "Declared a major incident via ARCUS" : "Major incident flag cleared via ARCUS",
    });
  }
}
