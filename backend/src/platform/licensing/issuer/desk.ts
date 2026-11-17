import { addDays, signDocument, utcDay, type Signer } from "../sdk/index.js";
import { REVOCATION_KIND } from "../activation.js";
import type { ArcusLicence } from "../licence.verify.js";
import { issueLicence, type IssueRequest } from "./issue.js";
import type { RegisterEntry, RegisterStore } from "./register.store.js";

/**
 * The licence desk: issuing, re-issuing and revoking with the register kept
 * in step (LIC-02). One implementation behind the CLI and the operator screen.
 */

/** Issues a licence, signs it, and records it in the register. */
export async function issueAndRegister(
  store: RegisterStore,
  signer: Signer,
  req: IssueRequest,
  meta: { by: string; reason: string; replaces?: string | null; now?: Date; reportPublicKey?: string },
): Promise<{ entry: RegisterEntry; text: string; licence: ArcusLicence }> {
  const now = meta.now ?? new Date();
  const id = await store.nextId(now.getUTCFullYear());
  const { text, licence } = await issueLicence(req, id, signer, now);
  const entry: RegisterEntry = {
    licenceId: id,
    customer: licence.customer_name,
    orderRef: licence.order_ref,
    binding: licence.binding,
    edition: licence.entitlements.edition,
    licenceType: licence.licence_type,
    validFrom: licence.valid_from,
    expiresAt: licence.expires_at,
    kid: licence.kid,
    text,
    request: req,
    issuedBy: meta.by,
    issuedAt: licence.issued_at,
    reason: meta.reason,
    replaces: meta.replaces ?? null,
    replacedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    ...(meta.reportPublicKey ? { reportPublicKey: meta.reportPublicKey } : {}),
  };
  await store.add(entry);
  if (meta.replaces) await store.markReplaced(meta.replaces, id);
  return { entry, text, licence };
}

/** What a re-issue may change; everything else is kept from the old licence. */
export interface ReissueChanges {
  edition?: IssueRequest["order"]["edition"];
  type?: IssueRequest["type"];
  agents?: number;
  concurrentSeats?: number;
  ciPacks?: number;
  aiPacks?: number;
  storagePacks?: number;
  addons?: IssueRequest["order"]["addons"];
  binding?: string;
  termYears?: number;
  validFrom?: string;
  expiresAt?: string;
}

/**
 * The request for a re-issue: the old one with the changes. The end date
 * stays unless the term, the start or the end date changes (an upgrade
 * mid-term keeps it).
 */
export function reissueRequest(old: IssueRequest, oldExpiresAt: string | null, c: ReissueChanges): IssueRequest {
  const req: IssueRequest = structuredClone(old);
  if (c.edition) req.order.edition = c.edition;
  if (c.type) req.type = c.type;
  if (c.agents !== undefined) req.order.agents = c.agents;
  if (c.concurrentSeats !== undefined) req.order.concurrentSeats = c.concurrentSeats;
  if (c.ciPacks !== undefined) req.order.ciPacks = c.ciPacks;
  if (c.aiPacks !== undefined) req.order.aiPacks = c.aiPacks;
  if (c.storagePacks !== undefined) req.order.storagePacks = c.storagePacks;
  if (c.addons) req.order.addons = c.addons;
  if (c.binding) req.binding = c.binding;
  if (c.termYears !== undefined) req.termYears = c.termYears;
  if (c.validFrom) req.validFrom = c.validFrom;
  delete req.expiresAt;
  if (c.expiresAt) req.expiresAt = c.expiresAt;
  else if (c.termYears === undefined && !c.validFrom && oldExpiresAt) req.expiresAt = oldExpiresAt;
  return req;
}

/** Is a register entry the one in force (not revoked, not replaced)? */
export const isCurrent = (e: RegisterEntry) => !e.revokedAt && !e.replacedBy;

/**
 * Licences to renew (SAS-03): current ones ending within 30, 60 and 90 days
 * of `today`. Each licence is in the nearest bucket only.
 */
export function renewals(entries: RegisterEntry[], today = utcDay(new Date())): { within30: RegisterEntry[]; within60: RegisterEntry[]; within90: RegisterEntry[] } {
  const ending = entries
    .filter((e) => isCurrent(e) && e.expiresAt !== null && e.expiresAt >= today && e.expiresAt <= addDays(today, 90))
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));
  return {
    within30: ending.filter((e) => e.expiresAt! <= addDays(today, 30)),
    within60: ending.filter((e) => e.expiresAt! > addDays(today, 30) && e.expiresAt! <= addDays(today, 60)),
    within90: ending.filter((e) => e.expiresAt! > addDays(today, 60)),
  };
}

/**
 * Activation (Intertec's side, LT-10): the request for a licence bound to
 * the installation that signed it, and to its cluster when it has one.
 */
export function activationIssueRequest(
  request: { installation_id: string; cluster_id: string | null; order_ref: string },
  order: Omit<IssueRequest, "binding" | "orderRef"> & { orderRef?: string },
): IssueRequest {
  return {
    ...order,
    orderRef: order.orderRef || request.order_ref,
    order: { ...order.order, deployment: "deployed" },
    binding: `install:${request.installation_id.toLowerCase()}${request.cluster_id ? `;cluster:${request.cluster_id}` : ""}`,
  };
}

/** Intertec's signed revocation list: every revoked licence in the register. */
export async function revocationListDocument(store: RegisterStore, signer: Signer, now = new Date()) {
  const revoked = (await store.list()).filter((e) => e.revokedAt).map((e) => e.licenceId).sort();
  return signDocument(REVOCATION_KIND, { product: "arcus", issued_at: now.toISOString(), revoked }, signer);
}
