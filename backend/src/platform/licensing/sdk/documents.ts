import { createHash, createPublicKey } from "node:crypto";
import { ALGORITHMS, canonicalJson, fromBase64Url, toBase64Url, type Algorithm } from "./format.js";
import type { Signer } from "./sign.js";
import { verifySignature } from "./verify.js";

/**
 * Signed JSON documents that travel between an installation and Intertec:
 * the usage report and the activation request (signed by the installation's
 * own key), and the revocation list (signed by Intertec). One shape for all:
 *
 *   { "kind", "alg", "key_id", "payload": {...}, "signature" }
 *
 * The signature covers the canonical JSON of everything but `signature`, so
 * the document can be pretty-printed, emailed and re-read without breaking it.
 */
export interface SignedDocument<P = unknown> {
  kind: string;
  alg: Algorithm;
  /** Which key signed it: a kid for Intertec keys, a fingerprint for an installation key. */
  key_id: string;
  payload: P;
  signature: string;
}

const signedPart = (d: Omit<SignedDocument, "signature">) =>
  Buffer.from(canonicalJson({ kind: d.kind, alg: d.alg, key_id: d.key_id, payload: d.payload }), "utf8");

export async function signDocument<P>(kind: string, payload: P, signer: Signer): Promise<SignedDocument<P>> {
  const unsigned = { kind, alg: signer.alg, key_id: signer.kid, payload };
  const signature = await signer.sign(signedPart(unsigned));
  return { ...unsigned, signature: toBase64Url(signature) };
}

export type DocumentCheck<P> = { ok: true; document: SignedDocument<P> } | { ok: false; message: string };

/**
 * Checks a signed document against the public key expected for it, and that
 * it is of the expected kind. Accepts the parsed object or its JSON text.
 */
export function verifyDocument<P>(input: unknown, expected: { kind: string; publicKeyPem: string; alg?: Algorithm }): DocumentCheck<P> {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return { ok: false, message: "The document is not JSON." };
    }
  }
  const d = doc as Partial<SignedDocument<P>> | null;
  if (!d || typeof d !== "object" || typeof d.kind !== "string" || typeof d.key_id !== "string" || typeof d.signature !== "string" || !("payload" in d)) {
    return { ok: false, message: "The document is not a signed document." };
  }
  if (d.kind !== expected.kind) return { ok: false, message: `Expected a ${expected.kind}, got a ${d.kind}.` };
  if (!(ALGORITHMS as readonly unknown[]).includes(d.alg) || (expected.alg && d.alg !== expected.alg)) {
    return { ok: false, message: "The document's signing algorithm is not accepted." };
  }
  let signature: Buffer;
  try {
    signature = fromBase64Url(d.signature);
  } catch {
    return { ok: false, message: "The document's signature is malformed." };
  }
  const ok = verifySignature(d.alg as Algorithm, expected.publicKeyPem, signedPart(d as SignedDocument), signature);
  return ok ? { ok: true, document: d as SignedDocument<P> } : { ok: false, message: "The document's signature does not match: it has been changed." };
}

/** A short, stable id for a public key: SHA-256 of its SPKI bytes, base64url, first 22 characters. */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return toBase64Url(createHash("sha256").update(der).digest()).slice(0, 22);
}
