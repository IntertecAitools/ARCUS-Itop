import { randomUUID } from "node:crypto";
import {
  addDays,
  releaseAllowed,
  checkBinding,
  checkClock,
  daysBetween,
  generateSigningKeyPair,
  termStatus,
  utcDay,
  type Site,
} from "./sdk/index.js";
import { EDITION_FEATURES, EDITION_NAMES, FEATURES, featureOfClass, featureOfRoute, lowestEditionWith } from "./editions.js";
import { agreementFor, type Agreement } from "./eula.js";
import { verifyArcusLicence, type ArcusKeyOptions, type ArcusLicence } from "./licence.verify.js";
import { INSTALLATION_SCOPE, type InstallationRow, type LicenceEvent, type LicenceRow, type LicenceStore, type StateRow } from "./licence.store.js";
import type {
  Edition,
  Feature,
  LicenceBanner,
  LicenceCheckResult,
  LicenceState,
  LicenceStatus,
  LicenceSummary,
  LicensingMode,
} from "./licence.types.js";

export interface LicensingSettings {
  mode: LicensingMode;
  keys: ArcusKeyOptions;
  /** TENANCY=on: one licence per tenant (SaaS). Off: one for the installation (deployed). */
  tenancy: boolean;
  /** What this installation is: a non-production key is refused on a production one. */
  installationKind: "production" | "nonprod" | "standby";
  /** How often licences are re-read and states recomputed. */
  refreshMs?: number;
  /**
   * Licence ids revoked in the register (SaaS: the platform's own register,
   * Build Guide section 5, "Revocation"). Re-read with the licences.
   */
  revokedIds?: () => Promise<ReadonlySet<string>>;
  /**
   * Deployed, in a cluster: its id (the Kubernetes namespace UID). A licence
   * bound to another cluster of the same installation works for 14 days
   * while a re-issued one is asked for (Build Guide, section 10).
   */
  clusterId?: string;
  /** This release's date (YYYY-MM-DD): a perpetual licence refuses releases after its maintenance (LIC-11). */
  releaseDate?: string;
}

/** Days a licence keeps working after the installation moved to another cluster. */
export const REACTIVATION_DAYS = 14;

const FEATURE_EDITIONS = Object.fromEntries(FEATURES.map((f) => [f, lowestEditionWith(f)])) as Record<Feature, Edition>;

/** Days of full use for a deployed installation that has no licence yet. */
export const TRIAL_DAYS = 30;
const EXPIRING_SOON_DAYS = 30;
const BLOCKING: ReadonlySet<LicenceState> = new Set(["read_only", "evaluation_mode", "evaluation_expired"]);

interface Logger {
  info?(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
}

/** One scope's entitlements and state, in memory. Nothing else in the BFF reads a licence. */
export interface ScopeStatus {
  scope: string;
  state: LicenceState;
  /** The licence in force, when there is a valid one. */
  licence?: ArcusLicence;
  /** Why there is none (evaluation mode). */
  problem?: string;
  features: Feature[];
  daysLeft: number | null;
  graceDaysLeft: number | null;
  nonProduction: boolean;
  maintenanceLapsed: boolean;
  /** The licence row in force (for EULA and history). */
  row?: LicenceRow;
  /** Who accepted the EULA (deployed) or the terms (SaaS) for this scope, when. */
  eula?: { by: string; at: Date };
  /** An earlier version of the agreement was accepted, not the current one. */
  eulaOutdated?: boolean;
  /** In the re-activation window after a cluster change: days left. */
  reactivationDaysLeft?: number;
}

export class LicenceError extends Error {
  override name = "LicenceError";
}

/**
 * The licence module: loads every scope's licence, verifies it, keeps the
 * entitlements in memory and works out the state, every minute. The only
 * code that decides what is allowed.
 */
export class LicenceService {
  private readonly cache = new Map<string, ScopeStatus>();
  private readonly highWater = new Map<string, Date>();
  private readonly lastState = new Map<string, LicenceState>();
  private readonly graceStarted = new Map<string, Date | null>();
  /** "scope|type|key|day" already recorded today: warnings are recorded once a day, not on every request. */
  private readonly recordedToday = new Set<string>();
  private installRow?: InstallationRow;
  /** Route (as registered) → the feature of the module that registered it. */
  private readonly routeModuleFeature = new Map<string, Feature>();
  private registeringFeature?: Feature;
  private revoked: ReadonlySet<string> = new Set();
  /** Revoked by Intertec's signed revocation list (deployed, online). */
  private listRevoked: ReadonlySet<string> = new Set();
  /** scope -> when its licence was first seen bound to another cluster. */
  private readonly rebindStarted = new Map<string, Date>();
  private timer?: NodeJS.Timeout;
  private loaded?: Promise<void>;

  constructor(
    private readonly store: LicenceStore,
    readonly settings: LicensingSettings,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {}

  /** The tables, for the usage service (they share the BFF database). */
  get usageStore(): LicenceStore {
    return this.store;
  }

  get mode(): LicensingMode {
    return this.settings.mode;
  }

  /** Makes the installation id on first start, then loads every scope. */
  init(): Promise<void> {
    this.loaded ??= (async () => {
      this.installRow = await this.store.installation(() => {
        const pair = generateSigningKeyPair("Ed25519");
        return { id: randomUUID(), reportPublicKeyPem: pair.publicKeyPem, reportPrivateKeyPem: pair.privateKeyPem };
      }, this.now());
      for (const r of await this.store.rebinds()) this.rebindStarted.set(r.scope, r.startedAt);
      for (const s of await this.store.states()) {
        this.highWater.set(s.scope, s.highWater);
        this.lastState.set(s.scope, s.state);
        this.graceStarted.set(s.scope, s.graceStartedAt);
      }
      await this.refresh();
    })();
    return this.loaded;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => void this.refresh().catch((err: unknown) => this.logger?.error?.({ err }, "licence refresh failed"));
    this.timer = setInterval(tick, this.settings.refreshMs ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  installation(): InstallationRow {
    if (!this.installRow) throw new Error("The licence module has not started.");
    return this.installRow;
  }

  /** The scope a request is for: the tenant, the installation, or none (a platform operator on the platform's own address). */
  scopeFor(tenantId: string | undefined): string | null {
    if (!this.settings.tenancy) return INSTALLATION_SCOPE;
    return tenantId ?? null;
  }

  private site(scope: string): Site {
    if (scope !== INSTALLATION_SCOPE) return { tenant: scope };
    return { installation: this.installation().id, ...(this.settings.clusterId ? { cluster: this.settings.clusterId } : {}) };
  }

  /** Applies Intertec's signed revocation list (deployed, fetched daily). */
  async applyRevocationList(revoked: readonly string[]): Promise<void> {
    this.listRevoked = new Set(revoked);
    await this.refresh();
  }

  /**
   * Re-reads the licences (so a key saved on another instance applies
   * everywhere), recomputes every known scope's state, and records changes.
   */
  async refresh(): Promise<void> {
    if (this.settings.revokedIds) this.revoked = await this.settings.revokedIds();
    const rows = await this.store.licences();
    const byScope = new Map<string, LicenceRow[]>();
    for (const r of rows) byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), r]);
    const scopes = new Set([...byScope.keys(), ...this.cache.keys(), ...this.lastState.keys()]);
    if (!this.settings.tenancy) scopes.add(INSTALLATION_SCOPE);
    const now = this.now();
    for (const scope of scopes) await this.update(scope, byScope.get(scope) ?? [], now);
  }

  /** The cached status of a scope (computed on first use for a tenant not seen yet). */
  async statusOf(scope: string): Promise<ScopeStatus> {
    await this.init();
    const hit = this.cache.get(scope);
    if (hit) return hit;
    const rows = (await this.store.licences()).filter((r) => r.scope === scope);
    return this.update(scope, rows, this.now());
  }

  /** The cached status, without waiting: undefined until the scope has been computed once. */
  peek(scope: string): ScopeStatus | undefined {
    return this.cache.get(scope);
  }

  isBlocking(status: ScopeStatus): boolean {
    return BLOCKING.has(status.state);
  }

  private verify(text: string) {
    return verifyArcusLicence(text, this.settings.keys);
  }

  /** Checks one licence for a scope: signature, binding, production. Returns the licence or why not. */
  private judge(scope: string, text: string): { licence: ArcusLicence; clusterChanged?: boolean } | { problem: string; tamper: boolean } {
    const r = this.verify(text);
    if (!r.ok) return { problem: r.message, tamper: r.reason === "signature" || r.reason === "format" };
    const l = r.licence;
    if (this.revoked.has(l.licence_id) || this.listRevoked.has(l.licence_id)) return { problem: `Licence ${l.licence_id} has been revoked.`, tamper: false };
    const binding = checkBinding(l.binding, this.site(scope));
    if (binding === "mismatch") {
      return { problem: `This licence is for ${l.binding.replace(/^tenant:/, "tenant ").replace(/^install:/, "installation ")}, not this one.`, tamper: false };
    }
    const expected = this.settings.tenancy ? "saas" : "deployed";
    if (l.entitlements.deployment !== expected) return { problem: `This is a ${l.entitlements.deployment} licence; this is a ${expected} installation.`, tamper: false };
    if (l.licence_type === "nonprod" && this.settings.installationKind === "production") {
      return { problem: "This is a non-production licence; this installation is marked as production.", tamper: false };
    }
    if (this.settings.releaseDate && !releaseAllowed(l, this.settings.releaseDate)) {
      return {
        problem: `This release (${this.settings.releaseDate}) came out after the licence's maintenance ended (${l.maintenance_until}). Keep the earlier release, or renew maintenance.`,
        tamper: false,
      };
    }
    return binding === "cluster_changed" ? { licence: l, clusterChanged: true } : { licence: l };
  }

  private async update(scope: string, rows: LicenceRow[], realNow: Date): Promise<ScopeStatus> {
    const clock = checkClock(realNow, this.highWater.get(scope));
    const now = clock.effectiveNow;
    const today = utcDay(now);
    let status: ScopeStatus;

    // The newest licence that verifies and has started wins; a renewal
    // uploaded early waits for its start date while the old one runs on.
    let chosen: { licence: ArcusLicence; row: LicenceRow; clusterChanged?: boolean } | undefined;
    let newestProblem: { problem: string; tamper: boolean } | undefined;
    for (const row of rows) {
      const j = this.judge(scope, row.text);
      if ("problem" in j) {
        if (row === rows[0]) newestProblem = j;
        continue;
      }
      if (j.licence.valid_from > today) continue;
      chosen = { licence: j.licence, row, ...(j.clusterChanged ? { clusterChanged: true } : {}) };
      break;
    }
    // A newest licence that fails its signature was changed in the database
    // (an upload is checked first): audited even when an older one still runs.
    if (newestProblem?.tamper) await this.recordOnce(scope, "tamper_detected", rows[0]!.id.toString(), newestProblem.problem, null, realNow);
    const base = { scope, nonProduction: false, maintenanceLapsed: false, graceDaysLeft: null as number | null };
    if (clock.rolledBack) {
      status = { ...base, state: "evaluation_mode", problem: "The server's clock is earlier than a time already seen: correct the clock.", features: [...FEATURES], daysLeft: null };
      await this.recordOnce(scope, "clock_warning", "", `Clock ${realNow.toISOString()} is before ${this.highWater.get(scope)!.toISOString()}.`, null, realNow);
    } else if (chosen) {
      const l = chosen.licence;
      const term = termStatus(l, now, EXPIRING_SOON_DAYS);
      const state: LicenceState =
        term.phase === "expired" ? (l.licence_type === "evaluation" ? "evaluation_expired" : "read_only") : term.phase === "grace" ? "grace" : term.phase === "expiring_soon" ? "expiring_soon" : "valid";
      status = {
        ...base,
        state,
        licence: l,
        row: chosen.row,
        features: [...EDITION_FEATURES[l.entitlements.edition]],
        daysLeft: term.daysLeft,
        graceDaysLeft: term.graceDaysLeft,
        nonProduction: l.licence_type === "nonprod",
        maintenanceLapsed: term.maintenanceLapsed,
      };
    } else if (newestProblem) {
      status = { ...base, state: "evaluation_mode", problem: newestProblem.problem, features: [...FEATURES], daysLeft: null };
    } else if (rows.length) {
      // Verified, but none has started yet.
      status = { ...base, state: "evaluation_mode", problem: "The licence installed has not started yet.", features: [...FEATURES], daysLeft: null };
    } else if (scope === INSTALLATION_SCOPE) {
      const ends = addDays(utcDay(this.installation().createdAt), TRIAL_DAYS - 1);
      const left = daysBetween(today, ends);
      status = { ...base, state: left >= 0 ? "trial" : "evaluation_expired", features: [...FEATURES], daysLeft: left >= 0 ? left : null, problem: "No licence is installed." };
    } else {
      status = { ...base, state: "evaluation_mode", problem: "No licence is installed for this customer.", features: [...FEATURES], daysLeft: null };
    }

    // Moved to another cluster (restored elsewhere): 14 days while a re-issued licence is asked for (LT-12).
    if (chosen?.clusterChanged && !clock.rolledBack) {
      let started = this.rebindStarted.get(scope);
      if (!started) {
        started = realNow;
        this.rebindStarted.set(scope, started);
        await this.store.saveRebind(scope, started);
        await this.event(scope, "state_changed", null, `The installation runs on another cluster (${this.settings.clusterId}) than its licence names; ${REACTIVATION_DAYS} days to activate again.`, realNow);
      }
      const left = REACTIVATION_DAYS - daysBetween(utcDay(started), today);
      status =
        left >= 0
          ? { ...status, state: "reactivation", reactivationDaysLeft: left }
          : { ...base, state: "evaluation_mode", problem: "The installation moved to another cluster more than 14 days ago: install a re-issued licence.", features: [...FEATURES], daysLeft: null };
    } else if (chosen && this.rebindStarted.has(scope)) {
      this.rebindStarted.delete(scope);
      await this.store.saveRebind(scope, null);
    }

    // Only an acceptance of the current agreement counts: a new version is accepted again.
    const accepted = rows.find((r) => r.eulaAcceptedBy && r.eulaAcceptedAt && r.eulaVersion === this.agreement.version);
    if (accepted) status.eula = { by: accepted.eulaAcceptedBy!, at: accepted.eulaAcceptedAt! };
    else if (rows.some((r) => r.eulaAcceptedBy)) status.eulaOutdated = true;

    // Grace start, state change and the clock's high-water mark.
    const previous = this.lastState.get(scope);
    let graceStartedAt = this.graceStarted.get(scope) ?? null;
    if (status.state === "grace" && previous !== "grace") graceStartedAt = realNow;
    if (status.state !== "grace") graceStartedAt = null;
    if (previous !== status.state) {
      await this.event(scope, "state_changed", null, `${previous ?? "none"} → ${status.state}${status.problem ? `: ${status.problem}` : ""}`, realNow);
    }
    const high = this.highWater.get(scope);
    const newHigh = !high || realNow > high ? realNow : high;
    if (previous !== status.state || !high || newHigh.getTime() - high.getTime() >= 60_000 || graceStartedAt !== this.graceStarted.get(scope)) {
      const row: StateRow = { scope, highWater: newHigh, state: status.state, graceStartedAt };
      await this.store.saveState(row);
    }
    this.highWater.set(scope, newHigh);
    this.lastState.set(scope, status.state);
    this.graceStarted.set(scope, graceStartedAt);
    this.cache.set(scope, status);
    return status;
  }

  // --- Edition gating ---------------------------------------------------------

  /** Registers a module's routes under its feature (called by app.ts for each module). */
  withModuleFeature(feature: Feature, register: () => void): void {
    this.registeringFeature = feature;
    try {
      register();
    } finally {
      this.registeringFeature = undefined;
    }
  }

  /** Fastify onRoute: remembers which module's feature a route belongs to. */
  noteRoute(url: string): void {
    if (this.registeringFeature) this.routeModuleFeature.set(url, this.registeringFeature);
  }

  /** The feature a route needs, if any (door 1 and door 2). */
  featureOfRoute(url: string): Feature | undefined {
    return featureOfRoute(url, this.routeModuleFeature.get(url));
  }

  /** The feature a record class needs, if any (door 3), from its lineage. */
  featureOfClass(lineage: readonly string[]): Feature | undefined {
    return featureOfClass(lineage);
  }

  /**
   * The features to hide for a tenant, when enforcing; undefined when nothing
   * is hidden (LICENSING=warn, or a platform operator on the platform's address).
   */
  async enforcedFeatures(tenantId: string | undefined): Promise<ReadonlySet<Feature> | undefined> {
    if (this.mode !== "enforce") return undefined;
    const scope = this.scopeFor(tenantId);
    if (scope === null) return undefined;
    return new Set((await this.statusOf(scope)).features);
  }

  /** What a refusal says: the feature, this edition, and the edition that has it. */
  featureRefusal(status: ScopeStatus, feature: Feature) {
    const edition = status.licence?.entitlements.edition ?? null;
    const includedIn = lowestEditionWith(feature);
    return {
      feature,
      edition,
      includedIn,
      message: `This is not included in your edition${edition ? ` (${EDITION_NAMES[edition]})` : ""}. It is part of ${EDITION_NAMES[includedIn]}.`,
    };
  }

  // --- What users see ---------------------------------------------------------

  /** GET /api/licence/status for one user. */
  toDto(status: ScopeStatus, viewer: { isAdmin: boolean; isStaff: boolean }): LicenceStatus {
    const l = status.licence;
    return {
      mode: this.mode,
      state: status.state,
      readOnly: this.mode === "enforce" && this.isBlocking(status),
      edition: l?.entitlements.edition ?? null,
      editionName: l ? EDITION_NAMES[l.entitlements.edition] : null,
      features: status.features,
      featureEditions: FEATURE_EDITIONS,
      licenceType: l?.licence_type ?? null,
      expiresAt: l?.expires_at ?? null,
      daysLeft: status.daysLeft,
      graceDaysLeft: status.graceDaysLeft,
      reactivationDaysLeft: status.reactivationDaysLeft ?? null,
      nonProduction: status.nonProduction,
      maintenanceLapsed: status.maintenanceLapsed,
      banners: this.banners(status, viewer),
      operator: false,
    };
  }

  /** Banners by state and audience (Build Guide, section 11, "Banners"). */
  banners(status: ScopeStatus, viewer: { isAdmin: boolean; isStaff: boolean }): LicenceBanner[] {
    const out: LicenceBanner[] = [];
    const warnOnly = this.mode === "warn" ? " (Licensing is in warning mode: nothing is blocked yet.)" : "";
    const l = status.licence;
    if (status.nonProduction) out.push({ kind: "nonprod", tone: "info", message: "Non-production licence: not for live use." });
    if (!viewer.isStaff) return out;
    // SaaS: the tenant's first administrator accepts the terms (LIC-17).
    // SaaS: until the first acceptance. Deployed: the EULA is accepted with the first key, so this shows only for a new version.
    if (viewer.isAdmin && status.licence && !status.eula) {
      out.push({ kind: "eula", tone: "info", message: `Accept the ${this.agreement.title.toLowerCase()} for your organisation on the Licence page (Administration).` });
    }
    switch (status.state) {
      case "expiring_soon":
        if (viewer.isAdmin && l?.expires_at) {
          out.push({ kind: "expiring_soon", tone: "info", message: `The licence ends on ${l.expires_at} (${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left). Renew it to keep working without interruption.` });
        }
        break;
      case "grace":
        out.push({
          kind: "grace",
          tone: "warning",
          message: `The licence ended on ${l?.expires_at}. ${status.graceDaysLeft} day${status.graceDaysLeft === 1 ? "" : "s"} of grace left before the service becomes read-only.`,
        });
        break;
      case "read_only":
        out.push({ kind: "read_only", tone: "danger", message: `The licence has ended. Agents can read but not change anything; data export still works. An administrator can install a new licence.${warnOnly}` });
        break;
      case "evaluation_expired":
        out.push({ kind: "evaluation_expired", tone: "danger", message: `The evaluation period has ended. Agents can read but not change anything; data export still works.${warnOnly}` });
        break;
      case "evaluation_mode":
        out.push({ kind: "evaluation_mode", tone: "danger", message: `No valid licence: ${status.problem ?? "the licence could not be checked."} An administrator must install a valid licence. Until then agents can read but not change anything.${warnOnly}` });
        break;
      case "reactivation":
        out.push({
          kind: "reactivation",
          tone: "warning",
          message: `This installation now runs on another cluster than its licence names. ${status.reactivationDaysLeft} day${status.reactivationDaysLeft === 1 ? "" : "s"} left to install a re-issued licence: create an activation request on the Licence page.`,
        });
        break;
      case "trial":
        out.push({ kind: "trial", tone: "info", message: `Evaluation: ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left. An administrator can install a licence.` });
        break;
      case "valid":
        break;
    }
    return out;
  }

  // --- Installing a key -------------------------------------------------------

  summary(l: ArcusLicence): LicenceSummary {
    const e = l.entitlements;
    return {
      licenceId: l.licence_id,
      customer: l.customer_name,
      orderRef: l.order_ref,
      edition: e.edition,
      editionName: EDITION_NAMES[e.edition],
      licenceType: l.licence_type,
      deployment: e.deployment,
      termYears: l.term_years,
      issuedAt: l.issued_at,
      validFrom: l.valid_from,
      expiresAt: l.expires_at,
      maintenanceUntil: l.maintenance_until,
      graceDays: l.grace_days,
      namedSeats: e.named_seats,
      concurrentSeats: e.concurrent_seats,
      ciLimit: e.ci_limit,
      aiActionsPerMonth: e.ai_actions_per_month,
      storageGb: e.storage_gb,
      addons: [...e.features],
      binding: l.binding,
    };
  }

  /** Checks a key for a scope without saving it, and says what would change. */
  async check(scope: string, text: string): Promise<LicenceCheckResult> {
    await this.init();
    const j = this.judge(scope, text);
    if ("problem" in j) return { ok: false, message: j.problem, changes: [], older: false };
    const current = (await this.statusOf(scope)).licence;
    const next = j.licence;
    const changes: string[] = [];
    const diff = (label: string, a: unknown, b: unknown) => {
      if (a !== b) changes.push(`${label} ${a ?? "none"} → ${b ?? "none"}`);
    };
    if (current) {
      diff("Edition", current.entitlements.edition, next.entitlements.edition);
      diff("Licence type", current.licence_type, next.licence_type);
      diff("End date", current.expires_at ?? "perpetual", next.expires_at ?? "perpetual");
      diff("Agents", current.entitlements.named_seats, next.entitlements.named_seats);
      diff("Concurrent sessions", current.entitlements.concurrent_seats, next.entitlements.concurrent_seats);
      diff("CIs", current.entitlements.ci_limit, next.entitlements.ci_limit);
      diff("AI actions a month", current.entitlements.ai_actions_per_month, next.entitlements.ai_actions_per_month);
      diff("Storage (GB)", current.entitlements.storage_gb ?? "not limited", next.entitlements.storage_gb ?? "not limited");
      diff("Add-ons", current.entitlements.features.join(", ") || "none", next.entitlements.features.join(", ") || "none");
    } else {
      changes.push(`Edition ${next.entitlements.edition}, ${next.entitlements.named_seats} agents, until ${next.expires_at ?? "perpetual"}`);
    }
    if (current && current.licence_id === next.licence_id) return { ok: false, message: "This licence is already installed.", summary: this.summary(next), changes: [], older: false };
    const older = !!current && next.issued_at < current.issued_at;
    return { ok: true, summary: this.summary(next), changes, older };
  }

  /**
   * Is the EULA still to be accepted here? Deployed: until the first
   * administrator accepts it, with the first key. SaaS: until the tenant's
   * first administrator accepts the terms.
   */
  async eulaRequired(scope: string): Promise<boolean> {
    return !(await this.statusOf(scope)).eula;
  }

  /** Records acceptance of the EULA (or SaaS terms) for a scope, with the version. */
  /** The agreement customers accept here: the terms of service (SaaS) or the EULA (deployed). */
  get agreement(): Agreement {
    return agreementFor(this.settings.tenancy);
  }

  async acceptEula(scope: string, by: string): Promise<void> {
    const { version, title } = this.agreement;
    if (!(await this.store.acceptEula(scope, by, this.now(), version))) throw new LicenceError("Install a licence before accepting its terms.");
    await this.event(scope, "eula_accepted", by, `Accepted the ${title.toLowerCase()} (${version}).`);
    await this.update(scope, (await this.store.licences()).filter((r) => r.scope === scope), this.now());
  }

  /** Saves a checked key. It applies at once here and within a minute on every other instance. */
  async install(scope: string, text: string, by: string, confirmOlder = false, acceptEula = false): Promise<LicenceCheckResult> {
    // Deployed: the first administrator to install a key accepts the EULA with it (LIC-17).
    const needsEula = !this.settings.tenancy && (await this.eulaRequired(scope));
    if (needsEula && !acceptEula) throw new LicenceError("Accept the end-user licence agreement to install the licence.");
    const result = await this.check(scope, text);
    if (!result.ok) {
      await this.event(scope, "refused", by, `Key refused: ${result.message}`, this.now());
      throw new LicenceError(result.message ?? "The licence was refused.");
    }
    if (result.older && !confirmOlder) {
      throw new LicenceError("This licence was issued before the one installed now. Confirm to install the older licence.");
    }
    await this.store.addLicence(scope, text.trim() + "\n", by, this.now());
    if (needsEula) {
      await this.store.acceptEula(scope, by, this.now(), this.agreement.version);
      await this.event(scope, "eula_accepted", by, `Accepted the ${this.agreement.title.toLowerCase()} (${this.agreement.version}) with ${result.summary!.licenceId}.`);
    }
    await this.event(scope, "key_uploaded", by, `${result.summary!.licenceId}${result.older ? " (older than the one it replaced; confirmed)" : ""}: ${result.changes.join("; ")}`, this.now());
    const rows = (await this.store.licences()).filter((r) => r.scope === scope);
    await this.update(scope, rows, this.now());
    return result;
  }

  // --- Events -----------------------------------------------------------------

  async event(scope: string, type: LicenceEvent["type"], actor: string | null, detail: string, at = this.now()): Promise<void> {
    try {
      await this.store.addEvent({ scope, type, actor, detail, at });
    } catch (err) {
      this.logger?.error?.({ err }, "could not record a licence event");
    }
  }

  /** Records an event at most once a day per scope, type and key. */
  async recordOnce(scope: string, type: LicenceEvent["type"], key: string, detail: string, actor: string | null = null, at = this.now()): Promise<void> {
    const id = `${scope}|${type}|${key}|${utcDay(at)}`;
    if (this.recordedToday.has(id)) return;
    if (this.recordedToday.size > 10_000) this.recordedToday.clear();
    this.recordedToday.add(id);
    await this.event(scope, type, actor, detail, at);
  }

  async history(scope: string, limit = 100): Promise<LicenceEvent[]> {
    return this.store.events(scope, limit);
  }
}
