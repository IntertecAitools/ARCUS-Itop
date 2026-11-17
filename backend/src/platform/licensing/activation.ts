import { keyFingerprint, localSigner, signDocument, verifyDocument, type SignedDocument, type TrustedKey } from "./sdk/index.js";
import type { InstallationRow } from "./licence.store.js";

/**
 * Deployed activation (Build Guide, section 10): the installation asks for
 * its licence with a small file it signs itself; Intertec issues a licence
 * bound to its installation id (and cluster, when it has one) and records
 * the installation's report key. Online, the request goes to Intertec's
 * activation address; offline, the administrator carries the file.
 */
export interface ActivationRequest {
  product: "arcus";
  installation_id: string;
  /** Kubernetes namespace UID, when the installation runs in a cluster. */
  cluster_id: string | null;
  /** The installation's report-signing public key: Intertec registers it to check usage reports. */
  report_public_key: string;
  report_key_id: string;
  /** This release (package version) and its release date. */
  version: string;
  release_date: string | null;
  order_ref: string;
  /** The licence installed now, if any (a re-activation after a move). */
  current_licence_id: string | null;
  requested_at: string;
}

export const ACTIVATION_KIND = "activation_request";
export const REVOCATION_KIND = "revocation_list";

/** Builds and signs an activation request with the installation's own key. */
export async function activationRequest(
  install: InstallationRow,
  meta: { clusterId?: string; version: string; releaseDate?: string; orderRef: string; currentLicenceId?: string; now: Date },
): Promise<SignedDocument<ActivationRequest>> {
  const keyId = keyFingerprint(install.reportPublicKeyPem);
  const payload: ActivationRequest = {
    product: "arcus",
    installation_id: install.id,
    cluster_id: meta.clusterId ?? null,
    report_public_key: install.reportPublicKeyPem,
    report_key_id: keyId,
    version: meta.version,
    release_date: meta.releaseDate ?? null,
    order_ref: meta.orderRef,
    current_licence_id: meta.currentLicenceId ?? null,
    requested_at: meta.now.toISOString(),
  };
  return signDocument(ACTIVATION_KIND, payload, localSigner(keyId, "Ed25519", install.reportPrivateKeyPem));
}

/**
 * Intertec's side: checks an activation request is signed by the key it
 * carries (the installation holds that key) and has not been altered.
 */
export function readActivationRequest(input: unknown): { ok: true; request: ActivationRequest } | { ok: false; message: string } {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return { ok: false, message: "The activation request is not JSON." };
    }
  }
  const key = (doc as { payload?: { report_public_key?: unknown } } | null)?.payload?.report_public_key;
  if (typeof key !== "string") return { ok: false, message: "This is not an activation request." };
  const check = verifyDocument<ActivationRequest>(doc, { kind: ACTIVATION_KIND, publicKeyPem: key, alg: "Ed25519" });
  if (!check.ok) return { ok: false, message: check.message };
  const p = check.document.payload;
  if (p.product !== "arcus" || !/^[0-9a-f-]{36}$/i.test(p.installation_id)) return { ok: false, message: "The activation request is incomplete." };
  if (check.document.key_id !== keyFingerprint(key)) return { ok: false, message: "The activation request names another key." };
  return { ok: true, request: p };
}

/** A revocation list (signed by Intertec): licences that must stop working. */
export interface RevocationList {
  product: "arcus";
  issued_at: string;
  revoked: string[];
}

/** Checks a revocation list against Intertec's trusted keys; the revoked ids, or why not. */
export function readRevocationList(input: unknown, trusted: readonly TrustedKey[]): { ok: true; list: RevocationList } | { ok: false; message: string } {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return { ok: false, message: "The revocation list is not JSON." };
    }
  }
  const keyId = (doc as { key_id?: unknown } | null)?.key_id;
  const key = trusted.find((k) => k.kid === keyId);
  if (!key) return { ok: false, message: `The revocation list is signed with an unknown key (${String(keyId)}).` };
  const check = verifyDocument<RevocationList>(doc, { kind: REVOCATION_KIND, publicKeyPem: key.publicKeyPem, alg: key.alg });
  if (!check.ok) return { ok: false, message: check.message };
  const l = check.document.payload;
  if (l.product !== "arcus" || !Array.isArray(l.revoked) || !l.revoked.every((id) => typeof id === "string")) {
    return { ok: false, message: "The revocation list is malformed." };
  }
  return { ok: true, list: l };
}
