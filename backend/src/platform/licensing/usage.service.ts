import { OVERAGE_PERCENT, WARN_AT } from "./editions.js";
import type { LicenceService, ScopeStatus } from "./licence.service.js";
import type { UsageDay, UsageStore } from "./licence.store.js";
import type { LicenceBanner, LimitMetric, UsageRow } from "./licence.types.js";
import { addDays, utcDay } from "./sdk/index.js";

/**
 * Live counts the licence module cannot make itself: they come from the
 * services that own the data (accounts, CIs), held to the current tenant by
 * the tenant-scoped client. Injected, so the module never speaks to the
 * system of record itself.
 */
export interface UsageCounters {
  /** Enabled staff accounts holding an agent profile, in the current tenant. */
  agents(): Promise<number>;
  /** Configuration items (FunctionalCI and its subclasses) in the current tenant. */
  cis(): Promise<number>;
}

export class LicenceLimitError extends Error {
  override name = "LicenceLimitError";
  constructor(
    message: string,
    readonly metric: LimitMetric,
    readonly used: number,
    readonly limit: number,
  ) {
    super(message);
  }
}

/** An agent session counts as active for 15 minutes after its last request. */
export const ACTIVE_MS = 15 * 60_000;
/** Seats and CIs shown on screens and in banners are at most five minutes old. */
const DISPLAY_CACHE_MS = 5 * 60_000;
const GB = 1024 ** 3;
/** Daily figures are kept two years. */
const KEEP_DAYS = 2 * 366;

/** The most a metric may reach before new use pauses: the limit plus 10% (LIC-09). */
export const hardCap = (limit: number) => Math.floor((limit * (100 + OVERAGE_PERCENT)) / 100);

const LABELS: Record<LimitMetric, string> = {
  agents: "Agents",
  sessions: "Agent sessions",
  cis: "Configuration items",
  ai_actions: "AI actions this month",
  storage: "Storage (GB)",
};

/**
 * Limits and metering (Build Guide, section 8). Each limit is checked where
 * usage grows, counted live at that moment, and kept as a daily figure.
 * Warnings at 80% and 100%; 10% overage allowed; past that, new use of that
 * kind pauses. Existing use is never taken away.
 */
export class UsageService {
  /** scope → login → last request time, for agents. */
  private readonly activity = new Map<string, Map<string, number>>();
  /** scope → today's peak of active agent sessions. */
  private readonly peaks = new Map<string, { day: string; peak: number }>();
  /** scope → the last live counts, for display and the daily figures. */
  private readonly counts = new Map<string, { at: number; agents: number; cis: number }>();

  constructor(
    private readonly licensing: LicenceService,
    private readonly store: UsageStore,
    private readonly counters: UsageCounters,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // --- Counting ---------------------------------------------------------------

  /** Notes an agent's request: the session counts as active for 15 minutes. */
  noteActivity(scope: string, login: string): void {
    const at = this.now().getTime();
    const byLogin = this.activity.get(scope) ?? new Map<string, number>();
    byLogin.set(login.toLowerCase(), at);
    this.activity.set(scope, byLogin);
    const active = this.activeSessions(scope);
    const day = utcDay(this.now());
    const peak = this.peaks.get(scope);
    if (!peak || peak.day !== day || active > peak.peak) this.peaks.set(scope, { day, peak: Math.max(active, peak?.day === day ? peak.peak : 0) });
  }

  /** Signs an agent out of the count (sign-out). */
  forget(scope: string, login: string): void {
    this.activity.get(scope)?.delete(login.toLowerCase());
  }

  activeSessions(scope: string, except?: string): number {
    const cutoff = this.now().getTime() - ACTIVE_MS;
    let n = 0;
    for (const [login, at] of this.activity.get(scope) ?? []) {
      if (at >= cutoff && login !== except?.toLowerCase()) n += 1;
    }
    return n;
  }

  isActive(scope: string, login: string): boolean {
    const at = this.activity.get(scope)?.get(login.toLowerCase());
    return at !== undefined && at >= this.now().getTime() - ACTIVE_MS;
  }

  /** Counts as they happen: an AI request, or bytes stored (negative when removed). */
  async recordUsage(scope: string, metric: "ai_actions" | "storage", amount: number): Promise<void> {
    await this.store.addUsage(scope, utcDay(this.now()), metric === "ai_actions" ? { aiActions: amount } : { storageBytes: amount });
  }

  private async live(scope: string, fresh: boolean): Promise<{ agents: number; cis: number }> {
    const hit = this.counts.get(scope);
    if (!fresh && hit && this.now().getTime() - hit.at < DISPLAY_CACHE_MS) return hit;
    const [agents, cis] = await Promise.all([this.counters.agents(), this.counters.cis()]);
    const row = { at: this.now().getTime(), agents, cis };
    this.counts.set(scope, row);
    return row;
  }

  private async metered(scope: string): Promise<{ aiActions: number; storageBytes: number }> {
    const today = utcDay(this.now());
    const monthStart = `${today.slice(0, 8)}01`;
    const days = await this.store.usageDays(scope, "0000-01-01", today);
    let aiActions = 0;
    let storageBytes = 0;
    for (const d of days) {
      if (d.day >= monthStart) aiActions += d.aiActions;
      storageBytes += d.storageBytes;
    }
    return { aiActions, storageBytes: Math.max(0, storageBytes) };
  }

  /** A metric's use and limit for a scope; the limit is null when it is not limited. */
  private async measure(scope: string, status: ScopeStatus, metric: LimitMetric, fresh: boolean): Promise<{ used: number; limit: number | null }> {
    const e = status.licence?.entitlements;
    if (!e) return { used: 0, limit: null };
    switch (metric) {
      case "agents":
        return { used: (await this.live(scope, fresh)).agents, limit: e.named_seats };
      case "cis":
        return { used: (await this.live(scope, fresh)).cis, limit: e.ci_limit };
      case "sessions":
        return { used: this.activeSessions(scope), limit: e.named_seats + e.concurrent_seats };
      case "ai_actions":
        return { used: (await this.metered(scope)).aiActions, limit: e.ai_actions_per_month };
      case "storage": {
        const bytes = (await this.metered(scope)).storageBytes;
        return { used: Math.round((bytes / GB) * 100) / 100, limit: e.storage_gb };
      }
    }
  }

  /** Usage against every limit, for the licence page. */
  async usage(scope: string): Promise<UsageRow[]> {
    const status = await this.licensing.statusOf(scope);
    const rows: UsageRow[] = [];
    for (const metric of ["agents", "sessions", "cis", "ai_actions", "storage"] as const) {
      const { used, limit } = await this.measure(scope, status, metric, false);
      const percent = limit === null ? null : limit === 0 ? (used > 0 ? 999 : 0) : Math.round((used / limit) * 100);
      rows.push({
        metric,
        label: LABELS[metric],
        used,
        limit,
        percent,
        level: percent === null ? "ok" : used > (limit === null ? Infinity : hardCap(limit!)) ? "over" : percent >= 100 ? "full" : percent >= WARN_AT[0] ? "warning" : "ok",
      });
    }
    return rows;
  }

  /** Limit banners for administrators: 80% and 100% of a limit, recorded once a day. */
  async banners(scope: string): Promise<LicenceBanner[]> {
    const status = await this.licensing.statusOf(scope);
    if (!status.licence) return [];
    const out: LicenceBanner[] = [];
    for (const row of await this.usage(scope)) {
      if (row.limit === null || row.level === "ok") continue;
      // No limit bought (concurrent seats, AI actions on Essentials) is not a warning.
      if (row.limit === 0 && row.used === 0) continue;
      const pct = row.level === "warning" ? WARN_AT[0] : WARN_AT[1];
      out.push({
        kind: "limit",
        tone: row.level === "warning" ? "info" : "warning",
        message:
          row.level === "over"
            ? `${row.label}: ${row.used} of ${row.limit} in use, past the 10% allowance. New ${row.label.toLowerCase()} are paused until the licence is extended.`
            : `${row.label}: ${row.used} of ${row.limit} in use (${row.percent}%).${row.level === "full" ? " Up to 10% more is allowed; then new use pauses." : ""}`,
      });
      await this.licensing.recordOnce(scope, "limit_warning", `${row.metric}:${pct}`, `${row.label} at ${row.percent}% (${row.used} of ${row.limit}).`);
    }
    return out;
  }

  // --- Enforcing --------------------------------------------------------------

  /**
   * Before usage grows by `amount`: refuses (LICENSING=enforce) or records
   * "would refuse" (warn) when it would pass the limit plus 10%. Nothing is
   * counted against a scope with no valid licence (it is read-only instead)
   * or a platform operator on the platform's own address.
   */
  async assertCanAdd(scope: string | null, metric: LimitMetric, amount = 1, who?: string): Promise<void> {
    if (scope === null) return;
    const status = await this.licensing.statusOf(scope);
    if (!status.licence) return;
    const { used, limit } = await this.measure(scope, status, metric, true);
    if (limit === null) return;
    const after = used + amount;
    for (const pct of WARN_AT) {
      if (after * 100 >= limit * pct && limit > 0) {
        await this.licensing.recordOnce(scope, "limit_warning", `${metric}:${pct}`, `${LABELS[metric]} at ${Math.round((after / limit) * 100)}% (${after} of ${limit}).`);
      }
    }
    if (after <= hardCap(limit)) return;
    const message = refusalMessage(metric, limit);
    if (this.licensing.mode === "warn") {
      await this.licensing.recordOnce(scope, "would_refuse", `limit:${metric}`, `Would have refused: ${message} (${used} in use)${who ? ` for ${who}` : ""}.`, who ?? null);
      return;
    }
    await this.licensing.recordOnce(scope, "refused", `limit:${metric}`, `Refused: ${message} (${used} in use)${who ? ` for ${who}` : ""}.`, who ?? null);
    throw new LicenceLimitError(message, metric, used, limit);
  }

  // --- Daily figures ----------------------------------------------------------

  /** Stores today's figures for every scope seen (the counts last measured), and drops figures older than two years. */
  async snapshot(): Promise<void> {
    const today = utcDay(this.now());
    const scopes = new Set([...this.counts.keys(), ...this.peaks.keys(), ...this.activity.keys()]);
    for (const scope of scopes) {
      const c = this.counts.get(scope);
      const peak = this.peaks.get(scope);
      await this.store.saveUsageDay(scope, today, {
        ...(c ? { agents: c.agents, cis: c.cis } : {}),
        peakSessions: peak?.day === today ? peak.peak : this.activeSessions(scope),
      });
    }
    await this.store.pruneUsage(addDays(today, -KEEP_DAYS));
  }

  async days(scope: string, from: string, to: string): Promise<UsageDay[]> {
    return this.store.usageDays(scope, from, to);
  }
}

function refusalMessage(metric: LimitMetric, limit: number): string {
  switch (metric) {
    case "agents":
      return `All ${limit} agent seats are in use`;
    case "sessions":
      return `All ${limit} agent sessions are in use; try again when someone signs out`;
    case "cis":
      return `The licence allows ${limit} configuration items; new ones are paused`;
    case "ai_actions":
      return `This month's ${limit} AI actions are used up; AI features pause until next month`;
    case "storage":
      return `The licence's ${limit} GB of storage is used up; new uploads are paused`;
  }
}
