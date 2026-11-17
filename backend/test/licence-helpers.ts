import { buildLicenceFields, type IssueRequest } from "../src/platform/licensing/issuer/issue.js";
import { generateSigningKeyPair, localSigner, signLicence, type Algorithm, type TrustedKey } from "../src/platform/licensing/sdk/index.js";
import type { ArcusLicence } from "../src/platform/licensing/licence.verify.js";

/**
 * Test keys: made once per run, never a real signing key (Build Guide,
 * section 14, "Test keys").
 */
const ed = generateSigningKeyPair("Ed25519");
export const TEST_KID = "test-1";
export const TEST_KEYS: TrustedKey[] = [{ kid: TEST_KID, alg: "Ed25519", publicKeyPem: ed.publicKeyPem }];
export const testSigner = localSigner(TEST_KID, "Ed25519", ed.privateKeyPem);

let rsa: { pair: ReturnType<typeof generateSigningKeyPair>; kid: string } | undefined;
/** An RSA-3072 key, made on first use (it takes a moment). */
export function rsaTestKey(): { key: TrustedKey; signer: ReturnType<typeof localSigner> } {
  rsa ??= { pair: generateSigningKeyPair("RSA-PSS-SHA256"), kid: "test-rsa" };
  return {
    key: { kid: rsa.kid, alg: "RSA-PSS-SHA256" as Algorithm, publicKeyPem: rsa.pair.publicKeyPem },
    signer: localSigner(rsa.kid, "RSA-PSS-SHA256", rsa.pair.privateKeyPem),
  };
}

export const BASE_REQUEST: IssueRequest = {
  customer: "Example Co",
  orderRef: "SO-45678",
  type: "subscription",
  termYears: 3,
  order: { edition: "PRO", deployment: "saas", agents: 60 },
  binding: "tenant:acme",
  validFrom: "2026-12-01",
};

/**
 * One licence in one line: `await testLicence({ order: { edition: "ESS" } })`.
 * Overrides merge into the request (and `order` into its order); `fields`
 * replaces signed fields directly, for cases the issuer would refuse.
 */
export async function testLicence(
  overrides: Partial<Omit<IssueRequest, "order">> & { order?: Partial<IssueRequest["order"]>; fields?: Partial<ArcusLicence>; id?: string } = {},
  signer = testSigner,
): Promise<{ text: string; licence: ArcusLicence }> {
  const { order, fields, id, ...rest } = overrides;
  const req: IssueRequest = { ...BASE_REQUEST, ...rest, order: { ...BASE_REQUEST.order, ...order } };
  const built = buildLicenceFields(req, id ?? "ARC-2026-000123", new Date("2026-11-16T09:00:00Z"));
  return signLicence({ ...built, ...fields }, signer);
}

/** Edits one field inside a signed file, keeping the old signature: a tampered key. */
export function tamper(text: string, edit: (fields: Record<string, unknown>) => void): string {
  const lines = text.trim().split("\n");
  const dot = lines.indexOf(".");
  const content = lines.slice(1, dot).join("");
  const fields = JSON.parse(Buffer.from(content, "base64url").toString("utf8")) as Record<string, unknown>;
  edit(fields);
  const sorted = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
      : v;
  const edited = Buffer.from(JSON.stringify(sorted(fields)), "utf8").toString("base64url");
  return [lines[0], edited, ...lines.slice(dot)].join("\n") + "\n";
}
