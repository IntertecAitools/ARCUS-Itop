import { constants, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import {
  ALGORITHMS,
  KEY_VERSIONS,
  LICENCE_TYPES,
  LicenceFormatError,
  fileLabel,
  parseLicenceFile,
  type Algorithm,
  type LicenceEnvelope,
} from "./format.js";
import { DEV_KID, type TrustedKey } from "./public-keys.js";

/** Why a licence was refused. Stable codes: products map them to states and messages. */
export type RefusalReason =
  | "format" //       not a licence file, or the content cannot be decoded
  | "unknown_key" //  signed by a key this release does not trust
  | "dev_key_refused" // a development licence on a build that refuses them
  | "signature" //    the content was changed after signing, or the signature is wrong
  | "version" //      a format version this release does not read
  | "product" //      a licence for another product
  | "fields"; //      signed, but a field is missing or malformed

export type VerifyResult<E> =
  | { ok: true; licence: LicenceEnvelope<E> }
  | { ok: false; reason: RefusalReason; message: string };

export interface VerifyOptions<E> {
  /** The product this installation is, e.g. "arcus". */
  product: string;
  trustedKeys: readonly TrustedKey[];
  /** Accept licences signed with the development key (kid "dev"). Never in production. */
  allowDevKey?: boolean;
  /**
   * Checks the product's `entitlements` object; returns problems (empty when
   * fine). Called only once the signature has been verified.
   */
  validateEntitlements: (entitlements: unknown) => string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isDate(v: unknown): v is string {
  return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

const isCount = (v: unknown, max = 10_000_000): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const isText = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;

/** Checks the envelope fields (not the entitlements). Returns problems, empty when fine. */
export function validateEnvelope(f: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  need(isText(f["product"], 40), "product");
  need((KEY_VERSIONS as readonly unknown[]).includes(f["key_version"]), "key_version");
  need((ALGORITHMS as readonly unknown[]).includes(f["alg"]), "alg");
  need(isText(f["kid"], 64), "kid");
  need(isText(f["licence_id"], 64), "licence_id");
  need(isText(f["customer_name"]), "customer_name");
  need(typeof f["order_ref"] === "string" && (f["order_ref"] as string).length <= 64, "order_ref");
  const type = f["licence_type"];
  need((LICENCE_TYPES as readonly unknown[]).includes(type), "licence_type");
  need(typeof f["issued_at"] === "string" && INSTANT.test(f["issued_at"] as string), "issued_at");
  need(isDate(f["valid_from"]), "valid_from");
  need(isCount(f["grace_days"], 365), "grace_days");
  need(isText(f["binding"], 200) && /^(tenant|install):[^\s]+$/.test(f["binding"] as string), "binding");
  const inst = f["instances"] as Record<string, unknown> | null;
  need(
    !!inst && typeof inst === "object" && isCount(inst["production"], 1000) && isCount(inst["nonprod"], 1000) && isCount(inst["standby"], 1000),
    "instances",
  );
  need(!!f["entitlements"] && typeof f["entitlements"] === "object" && !Array.isArray(f["entitlements"]), "entitlements");

  // Which dates a licence type carries.
  if (type === "subscription") need(isCount(f["term_years"], 10) && (f["term_years"] as number) >= 1, "term_years");
  else need(f["term_years"] === null, "term_years (subscription only)");
  if (type === "perpetual") {
    need(f["expires_at"] === null, "expires_at (not for perpetual)");
    need(isDate(f["maintenance_until"]), "maintenance_until");
  } else {
    need(isDate(f["expires_at"]), "expires_at");
    need(f["maintenance_until"] === null, "maintenance_until (perpetual only)");
  }
  if (isDate(f["valid_from"]) && isDate(f["expires_at"])) need((f["expires_at"] as string) >= (f["valid_from"] as string), "expires_at before valid_from");
  return problems;
}

function publicKey(pem: string): KeyObject {
  return createPublicKey(pem);
}

/** Checks a signature with a public key, by algorithm. Never throws: a bad key or signature is `false`. */
export function verifySignature(alg: Algorithm, publicKeyPem: string, data: Buffer, signature: Buffer): boolean {
  try {
    const key = publicKey(publicKeyPem);
    if (alg === "Ed25519") return key.asymmetricKeyType === "ed25519" && cryptoVerify(null, data, key, signature);
    if (key.asymmetricKeyType !== "rsa" && key.asymmetricKeyType !== "rsa-pss") return false;
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) return false;
    return cryptoVerify("sha256", data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, signature);
  } catch {
    return false;
  }
}

/**
 * Verifies a `.lic` text: the file's shape, that a trusted key signed exactly
 * this content, the format version, the product and every field. Pure: no
 * clock, no database. Binding and dates are separate checks (`checkBinding`,
 * `termStatus`), since they depend on where and when it runs.
 */
export function verifyLicence<E>(text: string, options: VerifyOptions<E>): VerifyResult<E> {
  let parsed;
  try {
    parsed = parseLicenceFile(text);
  } catch (err) {
    const message = err instanceof LicenceFormatError ? err.message : "This is not a licence file.";
    return { ok: false, reason: "format", message };
  }
  const f = parsed.fields as Record<string, unknown> | null;
  if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, reason: "format", message: "The licence content is not a set of fields." };

  const kid = typeof f["kid"] === "string" ? f["kid"] : "";
  if (kid === DEV_KID && !options.allowDevKey) {
    return { ok: false, reason: "dev_key_refused", message: "This is a development licence; this installation accepts only licences issued by Intertec." };
  }
  const key = options.trustedKeys.find((k) => k.kid === kid);
  if (!key) return { ok: false, reason: "unknown_key", message: `The licence is signed with a key this release does not know ("${kid || "none"}").` };
  // The algorithm comes from the trusted key, never from the file alone, so
  // a file cannot ask to be checked a weaker way.
  if (f["alg"] !== key.alg || !verifySignature(key.alg, key.publicKeyPem, Buffer.from(parsed.content, "ascii"), parsed.signature)) {
    return { ok: false, reason: "signature", message: "The licence's signature does not match its content: it has been changed or damaged." };
  }

  if (!(KEY_VERSIONS as readonly unknown[]).includes(f["key_version"])) {
    return { ok: false, reason: "version", message: `Licence format version ${String(f["key_version"])} is newer than this release reads.` };
  }
  if (f["product"] !== options.product || parsed.label !== fileLabel(options.product)) {
    return { ok: false, reason: "product", message: `This licence is for ${String(f["product"])}, not ${options.product}.` };
  }
  const problems = [...validateEnvelope(f), ...options.validateEntitlements(f["entitlements"]).map((p) => `entitlements.${p}`)];
  if (problems.length) return { ok: false, reason: "fields", message: `The licence has missing or malformed fields: ${problems.join(", ")}.` };
  return { ok: true, licence: f as unknown as LicenceEnvelope<E> };
}

// --- Binding -----------------------------------------------------------------

export type Binding =
  | { kind: "tenant"; tenant: string }
  | { kind: "install"; installation: string; cluster?: string };

/** "tenant:acme" | "install:<uuid>" | "install:<uuid>;cluster:<uid>". */
export function parseBinding(binding: string): Binding | undefined {
  const tenant = /^tenant:([A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/.exec(binding);
  if (tenant) return { kind: "tenant", tenant: tenant[1]! };
  const install = /^install:([0-9a-f-]{36})(?:;cluster:([A-Za-z0-9-]{1,64}))?$/i.exec(binding);
  if (install) return { kind: "install", installation: install[1]!.toLowerCase(), ...(install[2] ? { cluster: install[2] } : {}) };
  return undefined;
}

export function formatBinding(b: Binding): string {
  return b.kind === "tenant" ? `tenant:${b.tenant}` : `install:${b.installation}${b.cluster ? `;cluster:${b.cluster}` : ""}`;
}

/** Where this copy of the product runs. */
export interface Site {
  tenant?: string;
  installation?: string;
  cluster?: string;
}

/**
 * Is the licence for this site? `cluster_changed`: the right installation
 * restored onto another cluster; the product gives a re-activation window
 * rather than refusing at once.
 */
export function checkBinding(binding: string, site: Site): "match" | "mismatch" | "cluster_changed" {
  const b = parseBinding(binding);
  if (!b) return "mismatch";
  if (b.kind === "tenant") return site.tenant !== undefined && b.tenant === site.tenant ? "match" : "mismatch";
  if (!site.installation || b.installation !== site.installation.toLowerCase()) return "mismatch";
  if (b.cluster && site.cluster && b.cluster !== site.cluster) return "cluster_changed";
  return "match";
}
