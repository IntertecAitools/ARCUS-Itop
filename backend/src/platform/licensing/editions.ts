/**
 * The Arcus edition matrix and default limits: which features each edition
 * has and how the limits in a licence are worked out from an order. One
 * table, shared by the product (what is allowed) and the issuing CLI (what a
 * key may promise), so a key can never promise something the product does
 * not understand.
 *
 * DRAFT. Every feature placement and every number below is the Build
 * Guide's draft (section 3), awaiting Product's confirmation (section 17,
 * decisions 2-6). Changing them later is an edit to this file only.
 */

export const EDITIONS = ["ESS", "PRO", "ENT"] as const;
export type Edition = (typeof EDITIONS)[number];

export const EDITION_NAMES: Record<Edition, string> = {
  ESS: "Essentials",
  PRO: "Professional",
  ENT: "Enterprise",
};

/** Licence features: the unit of edition gating. */
export const FEATURES = [
  "service_desk",
  "service_levels",
  "knowledge",
  "cmdb",
  "import_export",
  "problem",
  "change",
  "approvals_forms",
  "analytics",
  "ai",
  "multi_org",
  "sso",
  "audit_sync",
] as const;
export type Feature = (typeof FEATURES)[number];

const ESSENTIALS: readonly Feature[] = ["service_desk", "service_levels", "knowledge", "cmdb", "import_export"];
// Single sign-on is in Professional: buyers of that size expect it, and
// Enterprise is set apart by multiple organisations and audit.
const PROFESSIONAL: readonly Feature[] = [...ESSENTIALS, "problem", "change", "approvals_forms", "analytics", "ai", "sso"];
const ENTERPRISE: readonly Feature[] = [...PROFESSIONAL, "multi_org", "audit_sync"];

/** DRAFT (section 3, "Draft edition matrix"). */
export const EDITION_FEATURES: Record<Edition, readonly Feature[]> = {
  ESS: ESSENTIALS,
  PRO: PROFESSIONAL,
  ENT: ENTERPRISE,
};

/** The cheapest edition that has a feature (for "included in Professional"). */
export function lowestEditionWith(feature: Feature): Edition {
  return EDITIONS.find((e) => EDITION_FEATURES[e].includes(feature)) ?? "ENT";
}

export function editionHas(edition: Edition, feature: Feature): boolean {
  return EDITION_FEATURES[edition].includes(feature);
}

/** DRAFT (section 3, "Draft limits per edition"): placeholders from the workbook's sample key. */
export interface EditionLimits {
  /** CIs included before packs. */
  cis: number;
  /** AI actions a month, per named agent. */
  aiActionsPerAgent: number;
  /** Storage per tenant, SaaS only. */
  storageGb: number;
}

export const EDITION_LIMITS: Record<Edition, EditionLimits> = {
  // CIs sized so a typical customer of each size is not at the limit in its
  // first month (about 3-5 CIs per employee).
  ESS: { cis: 2_500, aiActionsPerAgent: 0, storageGb: 100 },
  PRO: { cis: 10_000, aiActionsPerAgent: 300, storageGb: 250 },
  ENT: { cis: 50_000, aiActionsPerAgent: 500, storageGb: 500 },
};

/** DRAFT: pack sizes are not in the guide; placeholders until the SKU list exists (decision 7). */
export const PACK_SIZES = {
  /** CIs per CI pack. */
  ci: 1_000,
  /** AI actions a month per AI pack. */
  ai: 5_000,
  /** GB per storage pack (SaaS). */
  storageGb: 100,
} as const;

/** Add-on flags a licence may carry in `entitlements.features`. Edition features are never listed there. */
export const ADDON_FLAGS = ["byok", "dedicated_instance", "premium_support"] as const;
export type AddonFlag = (typeof ADDON_FLAGS)[number];

/** Add-ons an edition includes without being ordered. DRAFT. */
export const EDITION_ADDONS: Record<Edition, readonly AddonFlag[]> = {
  ESS: [],
  PRO: [],
  ENT: ["premium_support"],
};

/**
 * What is wrong with an order, empty when fine. AI packs need the AI
 * feature: an Essentials customer could not use them.
 */
export function orderProblems(order: Order): string[] {
  const problems: string[] = [];
  if ((order.aiPacks ?? 0) > 0 && !editionHas(order.edition, "ai")) {
    problems.push(`AI packs need an edition with AI (${EDITION_NAMES[lowestEditionWith("ai")]} or above).`);
  }
  return problems;
}

/** Percentages of a limit that raise a warning, and the overage allowed before new use pauses (LIC-09). */
export const WARN_AT = [80, 100] as const;
export const OVERAGE_PERCENT = 10;

/**
 * Profiles that make a staff account an agent (a named seat). Requesters
 * and portal users are never counted; administrators who also hold one of
 * these count. DRAFT (decision 4).
 */
export const AGENT_PROFILES: readonly string[] = [
  "Support Agent",
  "Service Desk Agent",
  "Problem Manager",
  "Change Implementor",
  "Change Supervisor",
  "Configuration Manager",
  "Service Manager",
];

export const DEPLOYMENTS = ["saas", "deployed"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

/** What an order buys, in the CLI's terms. */
export interface Order {
  edition: Edition;
  deployment: Deployment;
  agents: number;
  concurrentSeats?: number;
  ciPacks?: number;
  aiPacks?: number;
  storagePacks?: number;
  nodes?: number;
  addons?: AddonFlag[];
}

/** The Arcus part of a licence. */
export interface ArcusEntitlements {
  edition: Edition;
  deployment: Deployment;
  named_seats: number;
  /** Shared agent sessions; 0 means none bought. */
  concurrent_seats: number;
  ci_limit: number;
  /** Monitored nodes; kept for event management, not enforced yet. */
  node_limit: number;
  ai_actions_per_month: number;
  /** SaaS only; null on a deployed installation (not limited). */
  storage_gb: number | null;
  /** Add-on flags. */
  features: AddonFlag[];
}

/** Works out a licence's entitlements from an order, from the table above. */
export function entitlementsFor(order: Order): ArcusEntitlements {
  const limits = EDITION_LIMITS[order.edition];
  return {
    edition: order.edition,
    deployment: order.deployment,
    named_seats: order.agents,
    concurrent_seats: order.concurrentSeats ?? 0,
    ci_limit: limits.cis + (order.ciPacks ?? 0) * PACK_SIZES.ci,
    node_limit: order.nodes ?? 0,
    ai_actions_per_month: order.agents * limits.aiActionsPerAgent + (order.aiPacks ?? 0) * PACK_SIZES.ai,
    storage_gb: order.deployment === "saas" ? limits.storageGb + (order.storagePacks ?? 0) * PACK_SIZES.storageGb : null,
    features: [...new Set([...EDITION_ADDONS[order.edition], ...(order.addons ?? [])])].sort(),
  };
}

const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10_000_000;

/** Checks the `entitlements` object of an Arcus licence. Returns problems, empty when fine. */
export function validateArcusEntitlements(raw: unknown): string[] {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["(not an object)"];
  const problems: string[] = [];
  if (!(EDITIONS as readonly unknown[]).includes(e["edition"])) problems.push("edition");
  if (!(DEPLOYMENTS as readonly unknown[]).includes(e["deployment"])) problems.push("deployment");
  for (const k of ["named_seats", "concurrent_seats", "ci_limit", "node_limit", "ai_actions_per_month"]) {
    if (!isCount(e[k])) problems.push(k);
  }
  if (!(e["storage_gb"] === null || isCount(e["storage_gb"]))) problems.push("storage_gb");
  if (!Array.isArray(e["features"]) || !(e["features"] as unknown[]).every((f) => (ADDON_FLAGS as readonly unknown[]).includes(f))) {
    problems.push("features");
  }
  return problems;
}
