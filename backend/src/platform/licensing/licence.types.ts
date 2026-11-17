/**
 * Licensing DTOs. Mirrored, field for field, in
 * frontend/src/features/licensing/types.ts: that pairing is the contract.
 */

export type Edition = "ESS" | "PRO" | "ENT";

export type Feature =
  | "service_desk"
  | "service_levels"
  | "knowledge"
  | "cmdb"
  | "import_export"
  | "problem"
  | "change"
  | "approvals_forms"
  | "analytics"
  | "ai"
  | "multi_org"
  | "sso"
  | "audit_sync";

/** LICENSING: `warn` checks and records but blocks nothing; `enforce` blocks. (`off`: no licensing at all.) */
export type LicensingMode = "warn" | "enforce";

/**
 * Where a tenant (or the installation) stands. Every enforcement decision
 * reads this; nothing else looks at dates.
 *
 * - `valid`: verified, inside its dates.
 * - `expiring_soon`: within 30 days of the end date.
 * - `grace`: past the end date, within the grace days. Nothing is blocked.
 * - `read_only`: grace has ended. Agents can read but not change.
 * - `evaluation_mode`: no valid licence: edited or wrongly signed, for
 *   another tenant or installation, a non-production key on a production
 *   installation, the clock moved back, or (SaaS) none installed. As read-only.
 * - `trial`: a deployed installation with no licence yet, in its first 30 days.
 * - `evaluation_expired`: an evaluation licence (or the trial) has ended. As read-only.
 * - `reactivation`: a deployed installation now on another cluster than its
 *   licence names (restored elsewhere): it works for 14 days while a
 *   re-issued licence is asked for, then evaluation mode.
 */
export type LicenceState =
  | "valid"
  | "expiring_soon"
  | "grace"
  | "read_only"
  | "evaluation_mode"
  | "trial"
  | "evaluation_expired"
  | "reactivation";

export type LicenceType = "subscription" | "perpetual" | "evaluation" | "nonprod";

export type BannerKind = "expiring_soon" | "grace" | "read_only" | "evaluation_mode" | "trial" | "evaluation_expired" | "nonprod" | "limit" | "eula" | "reactivation";

export interface LicenceBanner {
  kind: BannerKind;
  tone: "info" | "warning" | "danger";
  message: string;
}

/** GET /api/licence/status: small, for every signed-in user; the shell reads it at start. */
export interface LicenceStatus {
  mode: LicensingMode;
  state: LicenceState;
  /** Changes by agents are refused now (enforce, and a read-only state). */
  readOnly: boolean;
  edition: Edition | null;
  editionName: string | null;
  /** Features the edition includes (all of them while there is no valid licence: it is read-only instead). */
  features: Feature[];
  /** The cheapest edition that includes each feature: what the "not in your edition" page names. */
  featureEditions: Record<Feature, Edition>;
  licenceType: LicenceType | null;
  /** Last day of use, YYYY-MM-DD; null for perpetual or no licence. */
  expiresAt: string | null;
  /** Days until expiresAt (trial: days of trial left). */
  daysLeft: number | null;
  graceDaysLeft: number | null;
  /** In the re-activation window after a cluster change: days left. */
  reactivationDaysLeft: number | null;
  nonProduction: boolean;
  /** Perpetual licence past its maintenance end: no upgrade rights. */
  maintenanceLapsed: boolean;
  /** The banners for this user (administrators see more). */
  banners: LicenceBanner[];
  /** A platform operator on the platform's own address: may use the Licences page (the licence desk). */
  operator: boolean;
}

/** What a licence grants, as shown to an administrator. */
export interface LicenceSummary {
  licenceId: string;
  customer: string;
  orderRef: string;
  edition: Edition;
  editionName: string;
  licenceType: LicenceType;
  deployment: "saas" | "deployed";
  termYears: number | null;
  issuedAt: string;
  validFrom: string;
  expiresAt: string | null;
  maintenanceUntil: string | null;
  graceDays: number;
  namedSeats: number;
  concurrentSeats: number;
  ciLimit: number;
  aiActionsPerMonth: number;
  /** null: not limited (deployed). */
  storageGb: number | null;
  addons: string[];
  binding: string;
}

/** POST /api/licence/check and PUT /api/licence: a key checked against this tenant or installation. */
export interface LicenceCheckResult {
  ok: boolean;
  /** Why it was refused, when it was. */
  message?: string;
  summary?: LicenceSummary;
  /** What would change, e.g. "Edition PRO → ENT", "Agents 60 → 80". */
  changes: string[];
  /** Issued before the licence now installed: saving it needs `confirmOlder`. */
  older: boolean;
}

/** What a licence limits. */
export type LimitMetric = "agents" | "sessions" | "cis" | "ai_actions" | "storage";

/** One limit against its use: a row of the licence page, a source of the limit banners. */
export interface UsageRow {
  metric: LimitMetric;
  label: string;
  used: number;
  /** null: not limited (storage on a deployed installation). */
  limit: number | null;
  percent: number | null;
  /** "warning" from 80%, "full" from 100%, "over" past the 10% allowance (new use paused). */
  level: "ok" | "warning" | "full" | "over";
}

/** One line of the licence history (bff_licence_events). */
export interface LicenceEventDto {
  id: number;
  at: string;
  type: string;
  /** The type in words: "Key installed", "State changed"… */
  label: string;
  actor: string | null;
  detail: string;
}

/** GET /api/licence: everything the licence page shows. Administrators only. */
export interface LicenceDetail {
  status: LicenceStatus;
  /** The licence in force; null while there is none (evaluation, no valid key). */
  summary: LicenceSummary | null;
  usage: UsageRow[];
  history: LicenceEventDto[];
  /** This user may install a key: the installation's administrators, or (SaaS) the platform operator. */
  canInstall: boolean;
  deployment: "saas" | "deployed";
  /** Deployed: this installation's id and the public key its reports are signed with. */
  installation: { id: string; reportKeyId: string; reportPublicKey: string } | null;
  /** Deployed: activation (Build Guide, section 10). */
  activation: {
    /** Requests are sent to Intertec directly (LICENCE_ACTIVATION_URL); otherwise downloaded as a file. */
    online: boolean;
    /** The cluster this installation runs in, when it has one. */
    clusterId: string | null;
    /** The last activation request and what came of it. */
    last: { at: string; result: string } | null;
  } | null;
  /** The end-user licence agreement (deployed) or terms of service (SaaS): LIC-17. */
  eula: {
    version: string;
    text: string;
    /** Not yet accepted for this tenant or installation. */
    required: boolean;
    acceptedBy: string | null;
    acceptedAt: string | null;
  };
}

/** One licence in the register, as the operator's Licences page shows it. */
export interface RegisterRow {
  licenceId: string;
  customer: string;
  orderRef: string;
  binding: string;
  edition: Edition;
  licenceType: LicenceType;
  validFrom: string;
  expiresAt: string | null;
  issuedBy: string;
  issuedAt: string;
  reason: string;
  replaces: string | null;
  replacedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  status: "current" | "replaced" | "revoked";
}

/** GET /api/platform/licences: the register and the renewals due (SAS-03). Platform operators only. */
export interface LicencesOverview {
  /** This server can sign (LICENCE_SIGNER); otherwise licences are issued with the CLI. */
  canIssue: boolean;
  licences: RegisterRow[];
  renewals: { within30: RegisterRow[]; within60: RegisterRow[]; within90: RegisterRow[] };
}

/** POST /api/platform/licences: an order, and for a new SaaS customer the tenant to create with it. */
export interface IssueLicenceInput {
  customer: string;
  orderRef: string;
  type: LicenceType;
  termYears?: number;
  edition: Edition;
  deployment: "saas" | "deployed";
  /** tenant:<id> or install:<uuid>; for a new tenant, tenant:<its id>. */
  binding: string;
  agents: number;
  concurrentSeats?: number;
  ciPacks?: number;
  aiPacks?: number;
  storagePacks?: number;
  validFrom?: string;
  reason?: string;
  /** SaaS: create this tenant in the same step (Build Guide, section 12). */
  newTenant?: { id: string; name: string; domains: string[]; orgIds: number[] };
}

/** What issuing (or re-issuing) did. */
export interface IssueLicenceResult {
  licence: RegisterRow;
  /** The .lic text, to send to a deployed customer. */
  text: string;
  /** SaaS: the licence was installed for its tenant straight away. */
  installed: boolean;
  tenantCreated: boolean;
}

/** POST /api/licence/activation-request: what activating did (Build Guide, section 10). */
export interface ActivationResponse {
  /** "online": sent to Intertec's activation address; "offline": a file to send. */
  mode: "online" | "offline";
  /** The signed request, to download (offline, or when sending failed). */
  request?: unknown;
  /** Online: the licence that came back was installed. */
  installed: boolean;
  message: string;
}
