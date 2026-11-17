/**
 * Licensing DTOs: the same JSON as backend/src/platform/licensing/licence.types.ts,
 * field for field. That pairing is the contract.
 */

export type Edition = 'ESS' | 'PRO' | 'ENT';

export type Feature =
  | 'service_desk'
  | 'service_levels'
  | 'knowledge'
  | 'cmdb'
  | 'import_export'
  | 'problem'
  | 'change'
  | 'approvals_forms'
  | 'analytics'
  | 'ai'
  | 'multi_org'
  | 'sso'
  | 'audit_sync';

/** LICENSING: `warn` checks and records but blocks nothing; `enforce` blocks. (`off`: no licensing at all.) */
export type LicensingMode = 'warn' | 'enforce';

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
 */
export type LicenceState =
  | 'valid'
  | 'expiring_soon'
  | 'grace'
  | 'read_only'
  | 'evaluation_mode'
  | 'trial'
  | 'evaluation_expired';

export type LicenceType = 'subscription' | 'perpetual' | 'evaluation' | 'nonprod';

export type BannerKind = 'expiring_soon' | 'grace' | 'read_only' | 'evaluation_mode' | 'trial' | 'evaluation_expired' | 'nonprod';

export interface LicenceBanner {
  kind: BannerKind;
  tone: 'info' | 'warning' | 'danger';
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
  nonProduction: boolean;
  /** Perpetual licence past its maintenance end: no upgrade rights. */
  maintenanceLapsed: boolean;
  /** The banners for this user (administrators see more). */
  banners: LicenceBanner[];
}

/** What a licence grants, as shown to an administrator. */
export interface LicenceSummary {
  licenceId: string;
  customer: string;
  orderRef: string;
  edition: Edition;
  editionName: string;
  licenceType: LicenceType;
  deployment: 'saas' | 'deployed';
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
  /** What would change, e.g. 'Edition PRO → ENT', 'Agents 60 → 80'. */
  changes: string[];
  /** Issued before the licence now installed: saving it needs `confirmOlder`. */
  older: boolean;
}
