import { addDays, parseBinding, signLicence, utcDay, type Instances, type LicenceType, type Signer } from "../sdk/index.js";
import { entitlementsFor, type Order } from "../editions.js";
import { ARCUS_PRODUCT, type ArcusLicence } from "../licence.verify.js";

/** Everything the issuer needs to build one Arcus licence. */
export interface IssueRequest {
  customer: string;
  orderRef: string;
  type: LicenceType;
  /** Subscription: 1, 3 or 5. Non-production: optional, default 1. */
  termYears?: number;
  order: Order;
  /** "tenant:<id>" or "install:<uuid>". */
  binding: string;
  /** YYYY-MM-DD; default today (UTC). */
  validFrom?: string;
  /** Override the computed end date (YYYY-MM-DD), e.g. a re-issue keeping its end date. */
  expiresAt?: string;
  /** Perpetual: override the maintenance end (default one year). */
  maintenanceUntil?: string;
  graceDays?: number;
  instances?: Instances;
}

export const DEFAULT_INSTANCES: Instances = { production: 1, nonprod: 1, standby: 1 };
const EVALUATION_DAYS = 30;
const DEFAULT_GRACE_DAYS = 30;

/** The last day of a term that starts on `from` and lasts `years` (2026-12-01 + 3 → 2029-11-30). */
export function endOfTerm(from: string, years: number): string {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  return addDays(utcDay(new Date(Date.UTC(y + years, m - 1, d))), -1);
}

export class IssueError extends Error {
  override name = "IssueError";
}

/** Builds the licence fields (unsigned) from a request. Checks what the verifier would refuse. */
export function buildLicenceFields(req: IssueRequest, licenceId: string, now: Date): Omit<ArcusLicence, "alg" | "kid"> {
  if (!req.customer.trim()) throw new IssueError("A customer name is required.");
  const binding = parseBinding(req.binding);
  if (!binding) throw new IssueError(`Binding "${req.binding}" must be tenant:<id> or install:<uuid>.`);
  if ((binding.kind === "tenant") !== (req.order.deployment === "saas")) {
    throw new IssueError("A SaaS licence binds to a tenant (tenant:<id>); a deployed one to an installation (install:<uuid>).");
  }
  if (!Number.isInteger(req.order.agents) || req.order.agents < 1) throw new IssueError("Agents must be a whole number, 1 or more.");
  if (req.type === "perpetual" && req.order.deployment !== "deployed") throw new IssueError("Perpetual licences are for deployed installations only.");

  const validFrom = req.validFrom ?? utcDay(now);
  let termYears: number | null = null;
  let expiresAt: string | null = null;
  let maintenanceUntil: string | null = null;
  let grace = req.graceDays ?? DEFAULT_GRACE_DAYS;
  switch (req.type) {
    case "subscription":
      if (![1, 3, 5].includes(req.termYears ?? 0)) throw new IssueError("A subscription term is 1, 3 or 5 years (--term).");
      termYears = req.termYears!;
      expiresAt = req.expiresAt ?? endOfTerm(validFrom, termYears);
      break;
    case "perpetual":
      maintenanceUntil = req.maintenanceUntil ?? endOfTerm(validFrom, 1);
      break;
    case "evaluation":
      expiresAt = req.expiresAt ?? addDays(validFrom, EVALUATION_DAYS - 1);
      grace = 0;
      break;
    case "nonprod":
      expiresAt = req.expiresAt ?? endOfTerm(validFrom, req.termYears ?? 1);
      break;
  }
  if (expiresAt !== null && expiresAt < validFrom) throw new IssueError("The end date is before the start date.");

  return {
    product: ARCUS_PRODUCT,
    key_version: 1,
    licence_id: licenceId,
    customer_name: req.customer.trim(),
    order_ref: req.orderRef.trim(),
    licence_type: req.type,
    term_years: termYears,
    issued_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    valid_from: validFrom,
    expires_at: expiresAt,
    maintenance_until: maintenanceUntil,
    grace_days: grace,
    binding: req.binding,
    instances: req.instances ?? DEFAULT_INSTANCES,
    entitlements: entitlementsFor(req.order),
  };
}

/** Builds, signs and returns the `.lic` text and its fields. */
export async function issueLicence(req: IssueRequest, licenceId: string, signer: Signer, now = new Date()): Promise<{ text: string; licence: ArcusLicence }> {
  return signLicence(buildLicenceFields(req, licenceId, now), signer);
}
