import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchRevocationList,
  MemoryLicenceStore,
  readActivationRequest,
  type ActivationRequest,
  type ActivationResponse,
  type LicenceDetail,
} from "../src/platform/licensing/index.js";
import { activationIssueRequest, issueAndRegister, revocationListDocument } from "../src/platform/licensing/issuer/desk.js";
import { MemoryRegisterStore } from "../src/platform/licensing/issuer/register.store.js";
import { verifyDocument, type SignedDocument } from "../src/platform/licensing/sdk/index.js";
import { licenceApp } from "./licence-app.js";

const ORDER = {
  customer: "Example Co",
  type: "subscription" as const,
  termYears: 1,
  validFrom: "2026-12-01",
  order: { edition: "PRO" as const, deployment: "deployed" as const, agents: 20 },
};

/** Intertec's side of an activation: request file in, licence file out. */
async function intertecActivates(t: Awaited<ReturnType<typeof licenceApp>>, requestDoc: unknown, register = new MemoryRegisterStore()) {
  const read = readActivationRequest(JSON.stringify(requestDoc, null, 2)); // emailed: pretty-printed
  assert.ok(read.ok, !read.ok ? read.message : "");
  const req = activationIssueRequest(read.request, { ...ORDER, orderRef: "" });
  const issued = await issueAndRegister(register, t.services.licenceDesk!.signer!, req, { by: "licence-desk", reason: "activation", reportPublicKey: read.request.report_public_key });
  return { ...issued, request: read.request, register };
}

describe("deployed activation", () => {
  it("LT-10: offline activation with request and response files", async () => {
    const t = await licenceApp();
    assert.equal((await t.status()).state, "trial", "a new installation starts in evaluation");
    const res = await t.send("POST", "/api/licence/activation-request", t.users.admin, { orderRef: "SO-45678" });
    assert.equal(res.statusCode, 200, res.body);
    const answer = res.json() as ActivationResponse;
    assert.equal(answer.mode, "offline");
    const doc = answer.request as SignedDocument<ActivationRequest>;
    assert.equal(doc.payload.installation_id, t.licensing.installation().id);
    assert.equal(doc.payload.order_ref, "SO-45678");
    assert.equal(doc.payload.version, "0.1.0-test");

    // Altered on the way: refused.
    const forged = JSON.parse(JSON.stringify(doc)) as SignedDocument<ActivationRequest>;
    forged.payload.installation_id = "00000000-0000-4000-8000-000000000000";
    assert.equal(readActivationRequest(forged).ok, false);

    // Intertec issues the response file, bound to that installation, and keeps its report key.
    const { text, entry, licence } = await intertecActivates(t, doc);
    assert.equal(licence.binding, `install:${t.licensing.installation().id}`);
    assert.equal(licence.order_ref, "SO-45678", "the order comes from the request");
    assert.equal(entry.reportPublicKey, t.licensing.installation().reportPublicKeyPem);

    // The administrator uploads it: it applies at once.
    assert.equal((await t.install(text)).statusCode, 200);
    assert.equal((await t.status()).state, "valid");
    const detail = (await t.send("GET", "/api/licence", t.users.admin)).json() as LicenceDetail;
    assert.equal(detail.activation?.online, false);
    assert.match(detail.activation?.last?.result ?? "", /Activation request created as a file/);

    // Its usage reports verify with the key Intertec registered (LT-15 end to end).
    const report = await t.send("GET", "/api/licence/usage-report?from=2026-12-01&to=2026-12-01", t.users.admin);
    assert.equal(verifyDocument(report.body, { kind: "usage_report", publicKeyPem: entry.reportPublicKey! }).ok, true);
  });

  it("online activation sends the request to Intertec and installs the licence that comes back", async () => {
    let t: Awaited<ReturnType<typeof licenceApp>>;
    const fakeIntertec = (async (_url: string, init?: RequestInit) => {
      const { text } = await intertecActivates(t, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ licence: text }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    t = await licenceApp({ settings: { activationUrl: "https://licences.intertec.example/activate" }, fetch: fakeIntertec });
    const res = await t.send("POST", "/api/licence/activation-request", t.users.admin, { orderRef: "SO-1", acceptEula: true });
    const answer = res.json() as ActivationResponse;
    assert.deepEqual([answer.mode, answer.installed], ["online", true], answer.message);
    assert.equal((await t.status()).state, "valid");
  });

  it("online, when Intertec cannot be reached, hands back the request to send instead", async () => {
    const down = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch;
    const t = await licenceApp({ settings: { activationUrl: "https://licences.intertec.example/activate" }, fetch: down });
    const answer = (await t.send("POST", "/api/licence/activation-request", t.users.admin, {})).json() as ActivationResponse;
    assert.equal(answer.installed, false);
    assert.match(answer.message, /could not be reached/);
    assert.ok(readActivationRequest(answer.request).ok);
    assert.equal((await t.send("POST", "/api/licence/activation-request", t.users.agent, {})).statusCode, 403);
  });

  it("LT-11: the licence stays valid after a restart: the installation id lives in the database", async () => {
    const store = new MemoryLicenceStore();
    const first = await licenceApp({ store });
    const id = first.licensing.installation().id;
    await first.install(await first.issue({ type: "subscription", order: { deployment: "deployed" } }));
    assert.equal((await first.status()).state, "valid");
    await first.app.close();
    // Every container replaced: a new BFF over the same database.
    const second = await licenceApp({ store });
    assert.equal(second.licensing.installation().id, id);
    const s = await second.status();
    assert.deepEqual([s.state, s.edition], ["valid", "PRO"]);
  });

  it("LT-12: restored to a new cluster, the licence works for 14 days, then asks for re-activation", async () => {
    const t = await licenceApp({ settings: { clusterId: "c-new" } });
    const id = t.licensing.installation().id;
    await t.install(await t.issue({ binding: `install:${id};cluster:c-old` }));
    let s = await t.status();
    assert.deepEqual([s.state, s.reactivationDaysLeft, s.readOnly], ["reactivation", 14, false]);
    assert.match(s.banners.map((b) => b.message).join(" "), /another cluster.*14 days left/);
    assert.equal((await t.write()).statusCode, 201, "nothing is blocked in the window");

    await t.advanceTo("2026-12-15T09:00:00Z"); // day 14
    assert.equal((await t.status()).reactivationDaysLeft, 0);
    await t.advanceTo("2026-12-16T09:00:00Z"); // day 15
    s = await t.status();
    assert.equal(s.state, "evaluation_mode");
    assert.match(s.banners[0]!.message, /moved to another cluster more than 14 days ago/);

    // The re-issued licence names the new cluster: valid again, window closed.
    await t.install(await t.issue({ binding: `install:${id};cluster:c-new` }, "ARC-2026-000500"));
    s = await t.status();
    assert.deepEqual([s.state, s.reactivationDaysLeft], ["valid", null]);
  });

  it("LT-07: a perpetual licence with lapsed maintenance refuses a newer release, and keeps the older one running", async () => {
    const perpetual = { type: "perpetual" as const, termYears: undefined };
    const older = await licenceApp({ settings: { releaseDate: "2027-06-01" } });
    await older.install(await older.issue(perpetual));
    await older.advanceTo("2028-03-01T09:00:00Z"); // maintenance ended 2027-11-30
    const s = await older.status(older.users.admin);
    assert.deepEqual([s.state, s.maintenanceLapsed], ["valid", true]);

    const newer = await licenceApp({ settings: { releaseDate: "2028-01-15" } });
    const refused = await newer.install(await newer.issue(perpetual));
    assert.equal(refused.statusCode, 400);
    assert.match((refused.json() as { error: { message: string } }).error.message, /This release \(2028-01-15\) came out after the licence's maintenance ended \(2027-11-30\)/);
  });

  it("applies Intertec's signed revocation list, and refuses an altered one", async () => {
    const t = await licenceApp();
    await t.install(await t.issue());
    const register = new MemoryRegisterStore();
    await register.add({ ...((await issueAndRegister(register, t.services.licenceDesk!.signer!, { ...ORDER, binding: "install:00000000-0000-4000-8000-000000000001", orderRef: "" }, { by: "x", reason: "x" })).entry), licenceId: "ARC-2026-000123" });
    await register.revoke("ARC-2026-000123", "licence-desk", "contract ended", "2026-12-02T00:00:00Z");
    const list = await revocationListDocument(register, t.services.licenceDesk!.signer!);
    assert.deepEqual(list.payload.revoked, ["ARC-2026-000123"]);

    const altered = { ...list, payload: { ...list.payload, revoked: [] } };
    const serve = (doc: unknown) => (async () => new Response(JSON.stringify(doc), { status: 200 })) as typeof fetch;
    assert.match(await fetchRevocationList(t.licensing, "https://x/revoked.json", serve(altered)), /changed/);
    assert.equal((await t.status()).state, "valid");

    assert.match(await fetchRevocationList(t.licensing, "https://x/revoked.json", serve(list)), /applied: 1 revoked/);
    const s = await t.status();
    assert.equal(s.state, "evaluation_mode");
    assert.match(s.banners[0]!.message, /has been revoked/);
  });
});
