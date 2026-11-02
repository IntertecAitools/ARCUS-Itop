import { currentCaller, currentTenant, runAs, runAsServiceAccount, type TenantScope } from "../../core/request-context.js";
import type { ItopClient, Logger } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { Mailer } from "../../platform/auth/mailer.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { DocStore } from "../../shared/doc-store.js";
import { itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import { reminderMail } from "./auto-close-mail.js";
import type { AutoCloseClass, AutoCloseDto, AutoCloseOutcome, AutoCloseRun, AutoCloseSettings } from "./auto-close.types.js";

/**
 * Closes resolved tickets the customer neither confirmed nor reopened.
 *
 * iTop declares an internal `ev_autoclose` stimulus on UserRequest and
 * Incident but gives it no transition, and nothing in iTop fires it, so a
 * resolved ticket stays resolved forever. This job does it: every check it
 * reads, per tenant, the tickets resolved longer ago than the tenant's
 * delay and closes them as the service account, with a public-log note. It
 * uses `ev_autoclose` when the iTop lifecycle has a resolved → closed
 * transition for it (an extension could add one), and `ev_close` otherwise.
 *
 * Until then the customer can confirm or reopen in the portal: reopening
 * moves the ticket out of Resolved, and resolving it again restarts the
 * clock (iTop sets a new resolution_date). Closed has no way out.
 *
 * The caller can be emailed a few days before; a ticket reminded about is
 * remembered (per resolution) so the email goes once.
 */

const DAY_MS = 86_400_000;
/** Most due tickets read per class per run; the next run takes the rest. */
const BATCH = 500;
const DOC_KIND = "auto-close";
const MARK_KIND = "auto-close-reminded";

export const DEFAULT_AUTO_CLOSE: AutoCloseSettings = {
  enabled: true,
  days: 7,
  requests: true,
  incidents: true,
  remind: true,
  remindDaysBefore: 2,
};

const CLASSES: Array<{ cls: AutoCloseClass; setting: "requests" | "incidents" }> = [
  { cls: "UserRequest", setting: "requests" },
  { cls: "Incident", setting: "incidents" },
];

/** A stored document as the current shape: anything missing or damaged takes the default. */
export function completeSettings(stored: unknown): AutoCloseSettings {
  const doc = typeof stored === "object" && stored !== null ? (stored as Partial<AutoCloseSettings>) : {};
  const bool = (key: "enabled" | "requests" | "incidents" | "remind") =>
    typeof doc[key] === "boolean" ? doc[key] : DEFAULT_AUTO_CLOSE[key];
  const int = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  const days = int(doc.days, 1, 365, DEFAULT_AUTO_CLOSE.days);
  const remindDaysBefore = int(doc.remindDaysBefore, 1, Math.max(1, days - 1), Math.min(DEFAULT_AUTO_CLOSE.remindDaysBefore, Math.max(1, days - 1)));
  return {
    enabled: bool("enabled"),
    days,
    requests: bool("requests"),
    incidents: bool("incidents"),
    remind: bool("remind") && days > 1,
    remindDaysBefore,
  };
}

/** One set of tickets a run covers: a tenant's, or (key "") those of organisations no tenant owns. */
export interface AutoCloseScope {
  key: string;
  tenant?: TenantScope;
  /** Organisations left out: the tenants' own, when "" runs with tenancy on. */
  excludeOrgIds?: number[];
}

export class AutoCloseService {
  private readonly lastRuns = new Map<string, AutoCloseRun>();
  private inFlight?: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly store: DocStore,
    /** Every scope the background check covers. */
    private readonly scopes: () => Promise<AutoCloseScope[]>,
    private readonly timeZone: string,
    /** The frontend's address, for the link in the reminder. */
    private readonly appBaseUrl: string,
    /** How often the background check runs; 0 turns it off. */
    private readonly intervalMs: number,
    /** Absent when no mail server is configured. */
    private readonly mailer?: Mailer,
    private readonly logger?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /* --------------------------------------------------------------------- *
   * Settings
   * --------------------------------------------------------------------- */

  private tenantKey(): string {
    return currentTenant()?.id ?? "";
  }

  private async settings(key: string): Promise<{ settings: AutoCloseSettings; updatedAt: string; updatedBy: string }> {
    const stored = await this.store.get<AutoCloseSettings>(key, DOC_KIND, "settings");
    return {
      settings: completeSettings(stored?.body),
      updatedAt: stored?.updatedAt ?? "",
      updatedBy: stored?.updatedBy ?? "",
    };
  }

  async get(): Promise<AutoCloseDto> {
    const key = this.tenantKey();
    const { settings, updatedAt, updatedBy } = await this.settings(key);
    const lastRun = this.lastRuns.get(key);
    return {
      ...settings,
      mailConfigured: this.mailer !== undefined,
      checkEveryMinutes: Math.round(this.intervalMs / 60_000),
      updatedAt,
      updatedBy,
      ...(lastRun ? { lastRun } : {}),
    };
  }

  async save(input: AutoCloseSettings): Promise<AutoCloseDto> {
    await this.store.put(this.tenantKey(), DOC_KIND, "settings", completeSettings(input), currentCaller()?.login ?? "");
    return this.get();
  }

  /* --------------------------------------------------------------------- *
   * The background check
   * --------------------------------------------------------------------- */

  /** Checks every interval until stop(). The first check starts at once. */
  start(): void {
    if (this.timer || this.intervalMs <= 0) return;
    const tick = () =>
      void this.runAll().catch((error: unknown) => this.logger?.error?.({ err: error }, "auto-close check failed"));
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref?.();
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => undefined);
  }

  /** One check over every scope. Overlapping calls share the check in flight. */
  runAll(): Promise<void> {
    this.inFlight ??= (async () => {
      for (const scope of await this.scopes()) {
        await this.runScope(scope);
      }
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** "Run now" from the admin page: the caller's own tenant only. */
  async runCurrent(): Promise<AutoCloseRun> {
    const key = this.tenantKey();
    const scope = (await this.scopes()).find((s) => s.key === key) ?? { key, tenant: currentTenant() };
    return this.runScope(scope);
  }

  private runScope(scope: AutoCloseScope): Promise<AutoCloseRun> {
    // Outside any request: no caller, the scope's tenant bound, iTop called as the service account.
    return runAs(undefined, () => runAsServiceAccount(() => this.runOnce(scope)), scope.tenant);
  }

  private async runOnce(scope: AutoCloseScope): Promise<AutoCloseRun> {
    const startedAt = new Date(this.now()).toISOString();
    const outcomes: AutoCloseOutcome[] = [];
    let truncated = false;
    let error: string | undefined;
    try {
      const { settings } = await this.settings(scope.key);
      if (settings.enabled) {
        const seen = new Set<string>();
        for (const { cls, setting } of CLASSES) {
          if (!settings[setting]) continue;
          truncated = (await this.runClass(scope, settings, cls, outcomes, seen)) || truncated;
        }
        if (!truncated) await this.forgetStaleMarks(scope.key, seen);
      }
    } catch (runError) {
      error = runError instanceof Error ? runError.message : String(runError);
      this.logger?.error?.({ err: runError, tenant: scope.key }, "auto-close could not read the resolved tickets");
    }
    const run: AutoCloseRun = {
      startedAt,
      finishedAt: new Date(this.now()).toISOString(),
      outcomes,
      truncated,
      ...(error ? { error } : {}),
    };
    this.lastRuns.set(scope.key, run);
    const count = (action: AutoCloseOutcome["action"]) => outcomes.filter((o) => o.action === action).length;
    if (outcomes.length > 0 || error) {
      this.logger?.info?.(
        { tenant: scope.key, closed: count("closed"), reminded: count("reminded"), failed: count("failed") },
        "auto-close check",
      );
    }
    return run;
  }

  /** The stimulus that closes a resolved ticket of this class. */
  private stimulus(cls: AutoCloseClass): "ev_autoclose" | "ev_close" {
    const transitions = this.schema.get(cls)?.lifecycle?.transitions["resolved"] ?? {};
    return transitions["ev_autoclose"] === "closed" ? "ev_autoclose" : "ev_close";
  }

  /** Closes the due tickets of a class and reminds about the nearly due; true when there were more than one batch. */
  private async runClass(
    scope: AutoCloseScope,
    settings: AutoCloseSettings,
    cls: AutoCloseClass,
    outcomes: AutoCloseOutcome[],
    seen: Set<string>,
  ): Promise<boolean> {
    const now = this.now();
    const closeBefore = toItopTime(new Date(now - settings.days * DAY_MS), this.timeZone);
    const reminding = settings.remind && this.mailer !== undefined;
    const readBefore = reminding
      ? toItopTime(new Date(now - (settings.days - settings.remindDaysBefore) * DAY_MS), this.timeZone)
      : closeBefore;
    const excluded = scope.excludeOrgIds?.length ? ` AND org_id NOT IN (${scope.excludeOrgIds.map(Number).join(",")})` : "";

    // Two reads, so tickets waiting for a reminder never crowd out those due to close.
    const read = async (from: string | undefined, before: string) => {
      const result = await this.client.call("core/get", {
        class: cls,
        key:
          `SELECT ${cls} WHERE status = 'resolved'` +
          `${from ? ` AND resolution_date >= '${from}'` : ""} AND resolution_date < '${before}'${excluded}`,
        output_fields: "ref,title,resolution_date,caller_id",
        limit: BATCH + 1,
        page: 1,
      });
      return normalizeObjects(result.objects);
    };
    const toClose = await read(undefined, closeBefore);
    const toRemind = readBefore > closeBefore ? await read(closeBefore, readBefore) : [];
    const truncated = toClose.length > BATCH || toRemind.length > BATCH;

    for (const row of toClose.slice(0, BATCH)) {
      const id = String(row.id);
      outcomes.push(await this.close(scope.key, cls, id, str(row.fields["ref"]) || `#${id}`, settings.days));
    }

    const callers = await this.callers(toRemind.slice(0, BATCH).map((row) => str(row.fields["caller_id"])));
    for (const row of toRemind.slice(0, BATCH)) {
      const f = row.fields;
      const id = String(row.id);
      const ref = str(f["ref"]) || `#${id}`;
      const resolvedAt = str(f["resolution_date"]);
      const mark = `${cls}:${id}:${resolvedAt}`;
      seen.add(mark);
      if (await this.store.get(scope.key, MARK_KIND, mark)) continue;
      const caller = callers.get(str(f["caller_id"]));
      if (!caller?.email) {
        outcomes.push({ class: cls, id, ref, action: "failed", reason: "the caller has no email address" });
        // Asked once per resolution, like a reminder sent.
        await this.store.put(scope.key, MARK_KIND, mark, { failed: true }, "auto-close");
        continue;
      }
      outcomes.push(await this.remind(scope.key, cls, id, ref, str(f["title"]), resolvedAt, caller, settings.days, mark));
    }
    return truncated;
  }

  private async close(key: string, cls: AutoCloseClass, id: string, ref: string, days: number): Promise<AutoCloseOutcome> {
    try {
      await this.client.call("core/apply_stimulus", {
        class: cls,
        key: Number(id),
        stimulus: this.stimulus(cls),
        fields: { public_log: `Closed automatically after ${days} days with no reply from the customer.` },
        output_fields: "id",
        comment: "Closed automatically via ARCUS",
      });
      for (const doc of await this.store.list(key, MARK_KIND, `${cls}:${id}:`)) {
        await this.store.delete(key, MARK_KIND, doc.key);
      }
      return { class: cls, id, ref, action: "closed" };
    } catch (error) {
      // Typically: the customer reopened or closed it a moment ago.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.({ err: error, class: cls, id }, "auto-close could not close a ticket");
      return { class: cls, id, ref, action: "failed", reason };
    }
  }

  private async remind(
    key: string,
    cls: AutoCloseClass,
    id: string,
    ref: string,
    title: string,
    resolvedAt: string,
    caller: { name: string; email: string },
    days: number,
    mark: string,
  ): Promise<AutoCloseOutcome> {
    try {
      const closesAt = new Date(Date.parse(itopTimeToIso(resolvedAt, this.timeZone)) + days * DAY_MS);
      const closesOn = new Intl.DateTimeFormat("en-GB", {
        timeZone: this.timeZone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(closesAt);
      const mail = reminderMail({
        ref,
        title,
        name: caller.name,
        closesOn,
        ticketUrl: `${this.appBaseUrl}/portal/requests/${id}`,
      });
      await this.mailer!.send({ to: caller.email, ...mail, headers: { "Auto-Submitted": "auto-generated" } });
      await this.store.put(key, MARK_KIND, mark, { sentTo: caller.email }, "auto-close");
      return { class: cls, id, ref, action: "reminded" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.({ err: error, class: cls, id }, "auto-close could not send a reminder");
      return { class: cls, id, ref, action: "failed", reason };
    }
  }

  /** The callers' names and addresses, read in one call. */
  private async callers(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
    const wanted = [...new Set(ids.filter((id) => /^\d+$/.test(id) && id !== "0"))];
    if (wanted.length === 0) return new Map();
    const result = await this.client.call("core/get", {
      class: "Person",
      key: `SELECT Person WHERE id IN (${wanted.join(",")})`,
      output_fields: "first_name,email",
    });
    return new Map(
      normalizeObjects(result.objects).map((row) => [
        String(row.id),
        { name: str(row.fields["first_name"]), email: str(row.fields["email"]).includes("@") ? str(row.fields["email"]) : "" },
      ]),
    );
  }

  /** Forgets reminders for tickets no longer waiting to close (reopened, closed by hand). */
  private async forgetStaleMarks(key: string, seen: Set<string>): Promise<void> {
    for (const doc of await this.store.list(key, MARK_KIND)) {
      if (!seen.has(doc.key)) await this.store.delete(key, MARK_KIND, doc.key);
    }
  }
}
