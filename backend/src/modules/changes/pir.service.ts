import { AppError, badRequest } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { DocStore } from "../../shared/doc-store.js";
import { itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import { DONE_STATUSES, readChange, STATUS, tenantKey, toHead, TYPE_OF_CLASS, type ChangeHead } from "./change-model.js";
import type { ChangePir, PirDueItem, PirIncident, PirInput, PirQueue, PirReview } from "./changes.types.js";

const PIR_KIND = "change-pir";

/** Closed changes older than this no longer ask for a review. */
export const PIR_LOOKBACK_DAYS = 90;
/** Changes the queue reads at most. */
const QUEUE_CAP = 500;

type StoredPir = Omit<PirReview, "completedBy" | "completedAt">;

/**
 * Post-implementation reviews: once a change is implemented (or monitored,
 * or closed) someone records how it went, what went well and badly, the
 * incidents it caused and the follow-up actions. iTop's Change has no place
 * for them, so they are kept in the BFF's own database by change id.
 */
export class ChangePirService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: DocStore,
    private readonly timeZone: string,
  ) {}

  private iso(value: unknown): string {
    const text = str(value);
    return text ? itopTimeToIso(text, this.timeZone) : "";
  }

  private toPir(change: ChangeHead, stored: { body: StoredPir; updatedAt: string; updatedBy: string } | undefined): ChangePir {
    const allowed = DONE_STATUSES.includes(change.status);
    return {
      changeId: String(change.id),
      ref: change.ref,
      title: change.title,
      type: change.type,
      status: STATUS[change.status] ?? "new",
      allowed,
      due: allowed && !stored,
      review: stored ? { ...stored.body, completedBy: stored.updatedBy, completedAt: stored.updatedAt } : null,
    };
  }

  async get(id: number): Promise<ChangePir> {
    const [change, stored] = await Promise.all([
      readChange(this.client, id),
      this.store.get<StoredPir>(tenantKey(), PIR_KIND, String(id)),
    ]);
    return this.toPir(change, stored);
  }

  async save(id: number, input: PirInput): Promise<ChangePir> {
    const change = await readChange(this.client, id);
    if (!DONE_STATUSES.includes(change.status)) {
      throw new AppError("conflict", "A change is reviewed once it is implemented.", {
        details: { reason: "not_implemented" },
      });
    }
    const body: StoredPir = {
      outcome: input.outcome,
      wentWell: input.wentWell.trim(),
      wentBadly: input.wentBadly.trim(),
      incidents: await this.incidents(input.incidentIds),
      followUps: input.followUps
        .map((f) => ({ text: f.text.trim(), owner: f.owner.trim(), due: f.due, done: f.done }))
        .filter((f) => f.text),
    };
    if (body.outcome !== "successful" && !body.wentBadly) {
      throw badRequest("Say what did not go well: the change was not fully successful.");
    }
    await this.store.put(tenantKey(), PIR_KIND, String(id), body, currentCaller()?.login ?? "");
    return this.get(id);
  }

  /** The incidents named, read as the caller (so only ones they can see). */
  private async incidents(ids: string[]): Promise<PirIncident[]> {
    const wanted = [...new Set(ids.map(Number))];
    if (wanted.length === 0) return [];
    const result = await this.client.call("core/get", {
      class: "Incident",
      key: `SELECT Incident WHERE id IN (${wanted.join(",")})`,
      output_fields: "ref,title",
    });
    const found = normalizeObjects(result.objects).map((r) => ({
      id: String(r.id),
      ref: str(r.fields["ref"]),
      title: str(r.fields["title"]),
    }));
    const missing = wanted.filter((id) => !found.some((f) => f.id === String(id)));
    if (missing.length > 0) throw badRequest(`Incident ${missing.join(", ")} was not found.`);
    return found;
  }

  /** Implemented, monitored, or recently closed changes with no review yet; waiting longest first. */
  async queue(): Promise<PirQueue> {
    const since = toItopTime(new Date(Date.now() - PIR_LOOKBACK_DAYS * 86_400_000), this.timeZone);
    const [result, reviewed] = await Promise.all([
      this.client.call("core/get", {
        class: "Change",
        key:
          "SELECT Change WHERE status IN ('implemented','monitored') OR " +
          `(status = 'closed' AND close_date >= '${since}')`,
        output_fields: "ref,title,status,org_name,team_name,end_date,close_date",
        limit: QUEUE_CAP,
        page: 1,
      }),
      this.store.list(tenantKey(), PIR_KIND),
    ]);
    const done = new Set(reviewed.map((d) => d.key));
    const items: PirDueItem[] = normalizeObjects(result.objects)
      .filter((row) => row.class in TYPE_OF_CLASS && !done.has(String(row.id)))
      .map((row) => {
        const head = toHead(row);
        return {
          id: String(row.id),
          ref: head.ref,
          title: head.title,
          type: head.type,
          status: STATUS[head.status] ?? "implemented",
          organization: str(row.fields["org_name"]),
          team: str(row.fields["team_name"]),
          endDate: this.iso(row.fields["end_date"]),
          closedAt: this.iso(row.fields["close_date"]),
        };
      })
      .sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999") || Number(a.id) - Number(b.id));
    return { items, lookbackDays: PIR_LOOKBACK_DAYS };
  }
}
