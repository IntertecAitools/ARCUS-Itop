/**
 * The licence file format: a common envelope that every Intertec product
 * shares, plus an `entitlements` object each product defines for itself.
 *
 * This folder is a self-contained package (see README.md): it imports only
 * Node built-ins, never anything else in the repository, so it can later be
 * lifted into a shared licensing SDK unchanged.
 *
 *   -----BEGIN ARCUS LICENCE-----
 *   <content: the fields as canonical JSON, base64url, wrapped at 64>
 *   .
 *   <signature over the content text, base64url, wrapped at 64>
 *   -----END ARCUS LICENCE-----
 *
 * The signature covers the content exactly as it appears in the file (the
 * base64url text with the line breaks removed), so nothing is re-encoded
 * between signing and checking.
 */

/** Format versions this package reads. A newer file is refused, not guessed at. */
export const KEY_VERSIONS = [1] as const;
export type KeyVersion = (typeof KEY_VERSIONS)[number];

/** Signature algorithms the verifier accepts (LIC-03). */
export const ALGORITHMS = ["Ed25519", "RSA-PSS-SHA256"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export const LICENCE_TYPES = ["subscription", "perpetual", "evaluation", "nonprod"] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

/** How many installations may use one licence, by kind. */
export interface Instances {
  production: number;
  nonprod: number;
  standby: number;
}

/**
 * The fields every product's licence carries. Dates are calendar days
 * (`YYYY-MM-DD`, UTC); `issued_at` is an instant (ISO 8601) so two licences
 * issued on one day still have an order.
 */
export interface LicenceEnvelope<E = unknown> {
  /** Which product the licence is for, e.g. "arcus". */
  product: string;
  key_version: KeyVersion;
  alg: Algorithm;
  /** Which signing key signed it. */
  kid: string;
  licence_id: string;
  customer_name: string;
  order_ref: string;
  licence_type: LicenceType;
  /** Subscription only; otherwise null. */
  term_years: number | null;
  issued_at: string;
  valid_from: string;
  /** Subscription, evaluation and non-production; null for perpetual. */
  expires_at: string | null;
  /** Perpetual only: last day of upgrade rights; otherwise null. */
  maintenance_until: string | null;
  /** Days of full use after `expires_at`. */
  grace_days: number;
  /** "tenant:<id>" or "install:<uuid>" (later ";cluster:<uid>"). */
  binding: string;
  instances: Instances;
  /** Product-specific: what the customer may use. */
  entitlements: E;
}

const BEGIN = (label: string) => `-----BEGIN ${label} LICENCE-----`;
const END = (label: string) => `-----END ${label} LICENCE-----`;
const FILE = /^-----BEGIN ([A-Z0-9][A-Z0-9 ]{0,30}) LICENCE-----\s+([A-Za-z0-9_\-\s]+?)\s+\.\s+([A-Za-z0-9_\-\s]+?)\s+-----END ([A-Z0-9][A-Z0-9 ]{0,30}) LICENCE-----$/;

/** The label in the file's first line: "ARCUS" for product "arcus". */
export function fileLabel(product: string): string {
  return product.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/**
 * JSON with keys sorted at every level and no spaces. Arrays keep their
 * order. `undefined` members are left out, as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(text: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url.");
  return Buffer.from(text, "base64url");
}

/** The content text a signer signs: base64url of the canonical JSON. */
export function encodeContent(licence: LicenceEnvelope): string {
  return toBase64Url(Buffer.from(canonicalJson(licence), "utf8"));
}

const wrap = (text: string) => text.match(/.{1,64}/g)?.join("\n") ?? "";

/** Writes the `.lic` text from the content and its signature (both base64url). */
export function writeLicenceFile(product: string, content: string, signature: string): string {
  const label = fileLabel(product);
  return `${BEGIN(label)}\n${wrap(content)}\n.\n${wrap(signature)}\n${END(label)}\n`;
}

export interface ParsedLicenceFile {
  label: string;
  /** The content text as signed (line breaks removed). */
  content: string;
  signature: Buffer;
  /** The decoded fields, not yet checked. */
  fields: unknown;
}

export class LicenceFormatError extends Error {
  override name = "LicenceFormatError";
}

/**
 * Splits a `.lic` text into its parts and decodes the JSON. Tolerates the
 * line breaks, indentation and CRLFs an email or a paste adds; checks
 * nothing else (that is the verifier's job).
 */
export function parseLicenceFile(text: string): ParsedLicenceFile {
  const m = FILE.exec(text.trim().replace(/\r\n?/g, "\n"));
  if (!m) throw new LicenceFormatError("This is not a licence file: expected BEGIN … LICENCE, the content, a dot, the signature and END.");
  const [, label, rawContent, rawSignature, endLabel] = m;
  if (label !== endLabel) throw new LicenceFormatError("The licence's BEGIN and END lines do not match.");
  const content = rawContent!.replace(/\s+/g, "");
  const signatureText = rawSignature!.replace(/\s+/g, "");
  let fields: unknown;
  try {
    fields = JSON.parse(fromBase64Url(content).toString("utf8"));
  } catch {
    throw new LicenceFormatError("The licence content cannot be read: it may have been cut or edited.");
  }
  return { label: label!, content, signature: fromBase64Url(signatureText), fields };
}
