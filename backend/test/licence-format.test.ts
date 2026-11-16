import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  addDays,
  canonicalJson,
  checkBinding,
  checkClock,
  generateSigningKeyPair,
  keyFingerprint,
  localSigner,
  parseLicenceFile,
  releaseAllowed,
  signDocument,
  termStatus,
  verifyDocument,
} from "../src/platform/licensing/sdk/index.js";
import { EDITION_FEATURES, EDITIONS, FEATURES, entitlementsFor, lowestEditionWith } from "../src/platform/licensing/editions.js";
import { buildLicenceFields, endOfTerm, IssueError } from "../src/platform/licensing/issuer/issue.js";
import { MemoryRegisterStore } from "../src/platform/licensing/issuer/register.store.js";
import { kmsSignArgs, kmsSigner } from "../src/platform/licensing/issuer/signers.js";
import { trustedKeys, verifyArcusLicence } from "../src/platform/licensing/licence.verify.js";
import { BASE_REQUEST, TEST_KEYS, rsaTestKey, tamper, testLicence } from "./licence-helpers.js";

const verify = (text: string, keys = TEST_KEYS) => verifyArcusLicence(text, { allowDevKey: false, keys });

describe("licence format", () => {
  it("writes canonical JSON: keys sorted at every level, no spaces", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("puts the Arcus fields inside entitlements and the common fields in the envelope", async () => {
    const { licence } = await testLicence();
    assert.equal(licence.product, "arcus");
    assert.deepEqual(Object.keys(licence.entitlements).sort(), [
      "ai_actions_per_month", "ci_limit", "concurrent_seats", "deployment", "edition", "features", "named_seats", "node_limit", "storage_gb",
    ]);
    for (const k of ["licence_id", "customer_name", "order_ref", "licence_type", "term_years", "issued_at", "valid_from", "expires_at",
      "maintenance_until", "grace_days", "binding", "instances", "key_version", "alg", "kid"]) {
      assert.ok(k in licence, k);
    }
  });

  it("survives the line breaks, indentation and CRLFs of an email or a paste", async () => {
    const { text } = await testLicence();
    const mangled = text.split("\n").map((l) => `   ${l}`).join("\r\n");
    assert.equal(verify(mangled).ok, true);
  });

  it("refuses something that is not a licence file", () => {
    const r = verify("hello");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "format");
  });
});

describe("LT-08: tamper detection", () => {
  it("verifies an untouched licence", async () => {
    const { text, licence } = await testLicence();
    const r = verify(text);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.licence, licence);
  });

  for (const [what, edit] of [
    ["more agents", (f: Record<string, unknown>) => ((f["entitlements"] as Record<string, unknown>)["named_seats"] = 600)],
    ["a later end date", (f: Record<string, unknown>) => (f["expires_at"] = "2039-11-30")],
    ["a better edition", (f: Record<string, unknown>) => ((f["entitlements"] as Record<string, unknown>)["edition"] = "ENT")],
    ["another tenant", (f: Record<string, unknown>) => (f["binding"] = "tenant:globex")],
  ] as const) {
    it(`refuses one edited field (${what}) as a signature failure`, async () => {
      const { text } = await testLicence();
      const r = verify(tamper(text, edit));
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.reason, "signature");
    });
  }

  it("refuses a licence whose file names a weaker algorithm than its key", async () => {
    const { text } = await testLicence();
    const r = verify(tamper(text, (f) => (f["alg"] = "RSA-PSS-SHA256")));
    assert.equal(!r.ok && r.reason, "signature");
  });

  it("refuses a licence signed by a key it does not trust (a home-made key)", async () => {
    const other = generateSigningKeyPair("Ed25519");
    const { text } = await testLicence({}, localSigner("test-1", "Ed25519", other.privateKeyPem));
    assert.equal(!verify(text).ok && (verify(text) as { reason: string }).reason, "signature");
    const { text: unknownKid } = await testLicence({}, localSigner("someone-else", "Ed25519", other.privateKeyPem));
    const r = verify(unknownKid);
    assert.equal(!r.ok && r.reason, "unknown_key");
  });

  it("verifies RSA-PSS-SHA256 (3072-bit) licences too", async () => {
    const { key, signer } = rsaTestKey();
    const { text } = await testLicence({}, signer);
    assert.equal(verify(text, [key]).ok, true);
    assert.equal(!verify(tamper(text, (f) => (f["grace_days"] = 300)), [key]).ok, true);
  });

  it("refuses the development key on a build that does not allow it", async () => {
    const dev = generateSigningKeyPair("Ed25519");
    const { text } = await testLicence({}, localSigner("dev", "Ed25519", dev.privateKeyPem));
    const refused = verifyArcusLicence(text, { allowDevKey: false, devPublicKeyPem: dev.publicKeyPem });
    assert.equal(!refused.ok && refused.reason, "dev_key_refused");
    assert.equal(verifyArcusLicence(text, { allowDevKey: true, devPublicKeyPem: dev.publicKeyPem }).ok, true);
    assert.equal(trustedKeys({ allowDevKey: false, devPublicKeyPem: dev.publicKeyPem }).some((k) => k.kid === "dev"), false);
  });

  it("refuses an unknown format version and another product, even when signed", async () => {
    const v2 = await testLicence({ fields: { key_version: 2 as 1 } });
    assert.equal(!verify(v2.text).ok && (verify(v2.text) as { reason: string }).reason, "version");
    const other = await testLicence({ fields: { product: "other" } });
    assert.equal(!verify(other.text).ok && (verify(other.text) as { reason: string }).reason, "product");
  });

  it("refuses a signed licence with malformed fields", async () => {
    const { text } = await testLicence({ fields: { expires_at: null } });
    const r = verify(text);
    assert.equal(!r.ok && r.reason, "fields");
    assert.match(!r.ok ? r.message : "", /expires_at/);
    const bad = await testLicence({ fields: { entitlements: { ...entitlementsFor(BASE_REQUEST.order), features: ["everything" as "byok"] } } });
    assert.match(!verify(bad.text).ok ? (verify(bad.text) as { message: string }).message : "", /entitlements\.features/);
  });
});

describe("LT-15: the signed usage report", () => {
  const install = generateSigningKeyPair("Ed25519");
  const signer = localSigner(keyFingerprint(install.publicKeyPem), "Ed25519", install.privateKeyPem);
  const report = {
    licence_id: "ARC-2026-000123",
    from: "2026-11-01",
    to: "2026-11-30",
    days: [{ day: "2026-11-01", agents: 41, peak_sessions: 12, cis: 3120, ai_actions: 210, storage_gb: 18.4 }],
    peaks: { agents: 41 },
  };

  it("verifies with the installation's registered public key", async () => {
    const doc = await signDocument("usage_report", report, signer);
    const text = JSON.stringify(doc, null, 2); // pretty-printed for email: still verifies
    const r = verifyDocument<typeof report>(text, { kind: "usage_report", publicKeyPem: install.publicKeyPem });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.document.payload.licence_id, "ARC-2026-000123");
  });

  it("fails once one byte is edited", async () => {
    const text = JSON.stringify(await signDocument("usage_report", report, signer));
    const edited = text.replace('"agents":41', '"agents":31');
    assert.notEqual(edited, text);
    assert.equal(verifyDocument(edited, { kind: "usage_report", publicKeyPem: install.publicKeyPem }).ok, false);
  });

  it("fails with another installation's key, or as another kind of document", async () => {
    const doc = await signDocument("usage_report", report, signer);
    const other = generateSigningKeyPair("Ed25519");
    assert.equal(verifyDocument(doc, { kind: "usage_report", publicKeyPem: other.publicKeyPem }).ok, false);
    assert.equal(verifyDocument(doc, { kind: "activation_request", publicKeyPem: install.publicKeyPem }).ok, false);
  });
});

describe("term, binding and clock", () => {
  const at = (day: string) => new Date(`${day}T12:00:00Z`);

  it("walks a subscription through active, expiring soon, grace and expired", async () => {
    const { licence } = await testLicence(); // 2026-12-01 → 2029-11-30, grace 30
    assert.equal(termStatus(licence, at("2026-11-30")).phase, "not_yet_valid");
    assert.equal(termStatus(licence, at("2027-06-01")).phase, "active");
    assert.equal(termStatus(licence, at("2029-11-01")).phase, "expiring_soon");
    assert.equal(termStatus(licence, at("2029-11-30")).daysLeft, 0);
    const grace = termStatus(licence, at("2029-12-01"));
    assert.deepEqual([grace.phase, grace.graceDaysLeft], ["grace", 29]);
    assert.equal(termStatus(licence, at("2029-12-30")).phase, "grace");
    assert.equal(termStatus(licence, at("2029-12-31")).phase, "expired");
  });

  it("gives an evaluation no grace: day 31 is expired", async () => {
    const { licence } = await testLicence({ type: "evaluation", fields: {} });
    assert.equal(licence.expires_at, addDays("2026-12-01", 29));
    assert.equal(termStatus(licence, at(addDays("2026-12-01", 29))).phase, "expiring_soon");
    assert.equal(termStatus(licence, at(addDays("2026-12-01", 30))).phase, "expired");
  });

  it("keeps a perpetual licence running after maintenance, but refuses later releases (LIC-11)", async () => {
    const { licence } = await testLicence({ type: "perpetual", binding: "install:7f3c2a10-8f7e-4d1b-9c39-2b7e5f0a1c22", order: { deployment: "deployed" } });
    assert.equal(licence.maintenance_until, "2027-11-30");
    const later = termStatus(licence, at("2031-01-01"));
    assert.deepEqual([later.phase, later.maintenanceLapsed], ["active", true]);
    assert.equal(releaseAllowed(licence, "2027-11-30"), true);
    assert.equal(releaseAllowed(licence, "2027-12-01"), false);
  });

  it("matches the binding to the tenant or installation, and spots a changed cluster", () => {
    const id = "7f3c2a10-8f7e-4d1b-9c39-2b7e5f0a1c22";
    assert.equal(checkBinding("tenant:acme", { tenant: "acme" }), "match");
    assert.equal(checkBinding("tenant:acme", { tenant: "globex" }), "mismatch");
    assert.equal(checkBinding(`install:${id}`, { installation: id.toUpperCase() }), "match");
    assert.equal(checkBinding(`install:${id};cluster:c-1`, { installation: id, cluster: "c-2" }), "cluster_changed");
    assert.equal(checkBinding(`install:${id}`, { tenant: "acme" }), "mismatch");
  });

  it("detects a clock moved back by more than a day and keeps the latest time seen", () => {
    const high = new Date("2027-03-01T00:00:00Z");
    assert.equal(checkClock(new Date("2027-02-28T06:00:00Z"), high).rolledBack, false);
    const back = checkClock(new Date("2026-12-31T00:00:00Z"), high);
    assert.deepEqual([back.rolledBack, back.effectiveNow.toISOString()], [true, high.toISOString()]);
  });
});

describe("issuing", () => {
  it("works out the limits from the edition and the packs (draft table)", () => {
    assert.deepEqual(entitlementsFor({ edition: "PRO", deployment: "saas", agents: 60 }), {
      edition: "PRO", deployment: "saas", named_seats: 60, concurrent_seats: 0, ci_limit: 5000, node_limit: 0,
      ai_actions_per_month: 18000, storage_gb: 250, features: [],
    });
    const e = entitlementsFor({ edition: "ESS", deployment: "deployed", agents: 10, ciPacks: 2, aiPacks: 1, addons: ["premium_support", "byok", "byok"] });
    assert.deepEqual([e.ci_limit, e.ai_actions_per_month, e.storage_gb, e.features], [3000, 5000, null, ["byok", "premium_support"]]);
  });

  it("each edition contains the one below it, and every feature is in some edition", () => {
    for (const f of EDITION_FEATURES.ESS) assert.ok(EDITION_FEATURES.PRO.includes(f));
    for (const f of EDITION_FEATURES.PRO) assert.ok(EDITION_FEATURES.ENT.includes(f));
    for (const f of FEATURES) assert.ok(EDITIONS.includes(lowestEditionWith(f)));
    assert.equal(lowestEditionWith("change"), "PRO");
    assert.equal(lowestEditionWith("sso"), "ENT");
  });

  it("ends a term the day before its anniversary", () => {
    assert.equal(endOfTerm("2026-12-01", 3), "2029-11-30");
    assert.equal(endOfTerm("2028-02-29", 1), "2029-02-28");
  });

  it("refuses orders the verifier would refuse", () => {
    const now = new Date();
    assert.throws(() => buildLicenceFields({ ...BASE_REQUEST, binding: "install:x" }, "ARC-1", now), IssueError);
    assert.throws(() => buildLicenceFields({ ...BASE_REQUEST, termYears: 2 }, "ARC-1", now), /1, 3 or 5/);
    assert.throws(() => buildLicenceFields({ ...BASE_REQUEST, type: "perpetual" }, "ARC-1", now), /deployed/);
  });

  it("numbers licences per year in the register", async () => {
    const store = new MemoryRegisterStore();
    assert.equal(await store.nextId(2026), "ARC-2026-000001");
    const { licence, text } = await testLicence({ id: "ARC-2026-000001" });
    await store.add({
      licenceId: licence.licence_id, customer: licence.customer_name, orderRef: licence.order_ref, binding: licence.binding,
      edition: "PRO", licenceType: "subscription", validFrom: licence.valid_from, expiresAt: licence.expires_at, kid: licence.kid,
      text, request: BASE_REQUEST, issuedBy: "test", issuedAt: licence.issued_at, reason: "new order", replaces: null,
      replacedBy: null, revokedAt: null, revokedBy: null, revokeReason: null,
    });
    assert.equal(await store.nextId(2026), "ARC-2026-000002");
    assert.equal(await store.nextId(2027), "ARC-2027-000001");
    await store.revoke("ARC-2026-000001", "test", "contract ended", "2026-12-02T00:00:00Z");
    await assert.rejects(store.revoke("ARC-2026-000001", "test", "again", "2026-12-03T00:00:00Z"), /already revoked/);
  });

  it("asks KMS for a raw RSA-PSS signature and passes it through", async () => {
    const args = kmsSignArgs({ keyId: "alias/arcus-licence-signing", kid: "arcus-2026-1", alg: "RSA-PSS-SHA256" }, "/tmp/m.bin");
    assert.deepEqual(args.slice(0, 10), ["kms", "sign", "--key-id", "alias/arcus-licence-signing", "--message", "fileb:///tmp/m.bin", "--message-type", "RAW", "--signing-algorithm", "RSASSA_PSS_SHA_256"]);
    // A fake `aws` that signs with a local RSA key, as KMS would.
    const { key, signer } = rsaTestKey();
    const fakeAws = (async (_cmd: string, a: readonly string[]) => {
      const file = a[a.indexOf("--message") + 1]!.slice("fileb://".length);
      return { stdout: (await signer.sign(readFileSync(file))).toString("base64"), stderr: "" };
    }) as unknown as Parameters<typeof kmsSigner>[1];
    const kms = kmsSigner({ keyId: "alias/x", kid: key.kid, alg: "RSA-PSS-SHA256" }, fakeAws);
    const { text } = await testLicence({}, kms);
    assert.equal(verify(text, [key]).ok, true);
    assert.equal(parseLicenceFile(text).label, "ARCUS");
  });
});

describe("the SDK is self-contained", () => {
  it("imports nothing but Node built-ins and its own files", () => {
    const dir = join(import.meta.dirname, "..", "src", "platform", "licensing", "sdk");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
        assert.ok(m[1]!.startsWith("node:") || /^\.\/[a-z-]+\.js$/.test(m[1]!), `${file} imports ${m[1]}`);
      }
    }
  });
});
