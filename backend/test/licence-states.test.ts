import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { isWriteExempt } from "../src/platform/licensing/index.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";
import { code, licenceApp as setup } from "./licence-app.js";
import { tamper } from "./licence-helpers.js";


describe("licence states and read-only mode", () => {
  it("installs a checked key at once, with no restart (LIC-13)", async () => {
    const t = await setup();
    assert.equal((await t.status()).state, "trial");
    const res = await t.install(await t.issue());
    assert.equal(res.statusCode, 200, res.body);
    const s = await t.status(t.users.admin);
    assert.deepEqual([s.state, s.edition, s.expiresAt], ["valid", "PRO", "2027-11-30"]);
    assert.ok(s.features.includes("change"));
    assert.ok(!s.features.includes("sso"));
    const history = await t.licensing.history("installation");
    assert.ok(history.some((e) => e.type === "key_uploaded" && e.actor === "admin"));
  });

  it("LT-06: expiry gives a grace banner for 30 days, then read-only; export still works", async () => {
    const t = await setup();
    await t.install(await t.issue()); // ends 2027-11-30, grace 30
    assert.equal((await t.write()).statusCode, 201);

    await t.advanceTo("2027-11-10T09:00:00Z");
    const soon = await t.status(t.users.admin);
    assert.equal(soon.state, "expiring_soon");
    assert.deepEqual(soon.banners.map((b) => b.kind), ["expiring_soon"]);
    assert.deepEqual((await t.status(t.users.agent)).banners, [], "expiring soon is for administrators");

    await t.advanceTo("2027-12-01T09:00:00Z");
    const grace = await t.status(t.users.agent);
    assert.deepEqual([grace.state, grace.graceDaysLeft, grace.readOnly], ["grace", 29, false]);
    assert.match(grace.banners[0]!.message, /29 days of grace left/);
    assert.equal((await t.write()).statusCode, 201, "nothing is blocked in grace");

    await t.advanceTo("2027-12-31T09:00:00Z");
    const ro = await t.status(t.users.agent);
    assert.deepEqual([ro.state, ro.readOnly], ["read_only", true]);
    assert.equal(ro.banners[0]!.kind, "read_only");
    const refused = await t.write();
    assert.equal(refused.statusCode, 403);
    assert.equal(code(refused), "LICENCE_READ_ONLY");
    assert.notEqual(code(await t.exportCsv()), "LICENCE_READ_ONLY", "export always works");
    assert.equal((await t.send("GET", "/api/objects/Organization", t.users.agent)).statusCode, 200, "reads work");

    // A renewal applies at once and lifts read-only.
    const renewal = await t.issue({ validFrom: "2027-12-01" }, "ARC-2027-000001");
    assert.equal((await t.install(renewal)).statusCode, 200);
    assert.equal((await t.status()).state, "valid");
    assert.equal((await t.write()).statusCode, 201);
  });

  it("LT-13: an evaluation key is read-only on day 31, and export still works", async () => {
    const t = await setup();
    await t.install(await t.issue({ type: "evaluation" }));
    await t.advanceTo("2026-12-30T09:00:00Z"); // day 30
    assert.equal((await t.status()).state, "expiring_soon");
    assert.equal((await t.write()).statusCode, 201);
    await t.advanceTo("2026-12-31T09:00:00Z"); // day 31
    const s = await t.status();
    assert.deepEqual([s.state, s.readOnly], ["evaluation_expired", true]);
    assert.equal(code(await t.write()), "LICENCE_READ_ONLY");
    assert.notEqual(code(await t.exportCsv()), "LICENCE_READ_ONLY");
  });

  it("without any licence, a deployed installation runs a 30-day evaluation from its first start, then read-only", async () => {
    const t = await setup();
    const s = await t.status();
    assert.deepEqual([s.state, s.daysLeft], ["trial", 29]);
    await t.advanceTo("2026-12-31T09:00:00Z");
    assert.equal((await t.status()).state, "evaluation_expired");
    assert.equal(code(await t.write()), "LICENCE_READ_ONLY");
  });

  it("LT-09: a clock moved back 60 days is detected and does not extend the term", async () => {
    const t = await setup();
    await t.install(await t.issue());
    await t.advanceTo("2027-12-31T09:00:00Z");
    assert.equal((await t.status()).state, "read_only");
    // Someone sets the clock back 60 days to reach the licence's dates again.
    await t.advanceTo("2027-11-01T09:00:00Z");
    const s = await t.status();
    assert.equal(s.state, "evaluation_mode", "not valid again");
    assert.match(s.banners[0]!.message, /clock/);
    assert.equal(code(await t.write()), "LICENCE_READ_ONLY");
    const events = await t.licensing.history("installation");
    assert.ok(events.some((e) => e.type === "clock_warning"));
    // The clock is put right: the licence recovers by itself (here: still expired).
    await t.advanceTo("2028-01-01T09:00:00Z");
    assert.equal((await t.status()).state, "read_only");
  });

  it("LT-08: a key edited in the database puts the scope in evaluation mode, with an audit event", async () => {
    const t = await setup();
    const text = await t.issue();
    // Saved straight into the table, past the upload check, then edited.
    await t.store.addLicence("installation", tamper(text, (f) => ((f["entitlements"] as Record<string, unknown>)["named_seats"] = 500)), "db", t.clock.now);
    await t.licensing.refresh();
    const s = await t.status(t.users.admin);
    assert.equal(s.state, "evaluation_mode");
    assert.match(s.banners[0]!.message, /changed or damaged/);
    assert.ok((await t.licensing.history("installation")).some((e) => e.type === "tamper_detected"));
    assert.equal(code(await t.write()), "LICENCE_READ_ONLY");
  });

  it("never saves a key that fails the check, and says what a good one changes", async () => {
    const t = await setup();
    await t.install(await t.issue());
    const bad = await t.install(tamper(await t.issue(), (f) => (f["expires_at"] = "2040-01-01")));
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().error.message, /signature/);
    const other = await t.install(await t.issue({ binding: "install:00000000-0000-4000-8000-000000000000" }, "ARC-2026-000777"));
    assert.equal(other.statusCode, 400);
    assert.match(other.json().error.message, /not this one/);

    const upgrade = await t.issue({ order: { edition: "ENT", agents: 20 } }, "ARC-2026-000200");
    const check = (await t.send("POST", "/api/licence/check", t.users.admin, { text: upgrade })).json();
    assert.equal(check.ok, true);
    assert.ok(check.changes.includes("Edition PRO → ENT"));
    assert.ok(check.changes.includes("Agents 10 → 20"));
    assert.equal((await t.status()).edition, "PRO", "checking saves nothing");
    assert.equal((await t.send("POST", "/api/licence/check", t.users.agent, { text: upgrade })).statusCode, 403);
    assert.equal((await t.install(upgrade, t.users.agent)).statusCode, 403, "only administrators install");
  });

  it("asks for confirmation before replacing a licence with an older one", async () => {
    const t = await setup();
    const older = await t.issue({}, "ARC-2026-000001");
    t.clock.now = new Date("2026-12-02T09:00:00Z");
    await t.install(await t.issue({ order: { agents: 5 } }, "ARC-2026-000002"));
    const replay = await t.install(older);
    assert.equal(replay.statusCode, 400);
    assert.match(replay.json().error.message, /issued before/);
    assert.equal((await t.install(older, t.users.admin, true)).statusCode, 200);
    assert.ok((await t.licensing.history("installation")).some((e) => /confirmed/.test(e.detail)));
  });

  it("LT-14: a non-production key shows its banner to everyone, and is refused on a production installation", async () => {
    const prod = await setup({ kind: "production" });
    const refused = await prod.install(await prod.issue({ type: "nonprod" }));
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().error.message, /non-production/);

    const t = await setup({ kind: "nonprod" });
    assert.equal((await t.install(await t.issue({ type: "nonprod" }))).statusCode, 200);
    for (const who of [t.users.admin, t.users.agent, t.users.requester]) {
      const s = await t.status(who);
      assert.equal(s.nonProduction, true);
      assert.deepEqual(s.banners.map((b) => b.kind), ["nonprod"]);
    }
    assert.equal((await t.write()).statusCode, 201, "a non-production key blocks nothing");
  });

  it("keeps requesters out of it: the portal works whatever the state", async () => {
    const t = await setup();
    await t.advanceTo("2027-02-01T09:00:00Z"); // trial over: read-only
    assert.equal((await t.status(t.users.requester)).banners.length, 0);
    assert.ok(isWriteExempt("POST", "/api/portal/requests"));
    assert.ok(isWriteExempt("PUT", "/api/licence"));
    assert.ok(isWriteExempt("POST", "/api/auth/logout"));
    assert.ok(isWriteExempt("GET", "/api/objects/:class/export"));
    assert.ok(!isWriteExempt("POST", "/api/objects/:class"));
    assert.ok(!isWriteExempt("POST", "/api/objects/:class/:id/stimulus"));
  });

  it("LICENSING=warn records what it would have refused, once a day, and blocks nothing", async () => {
    const t = await setup({ mode: "warn" });
    await t.advanceTo("2027-02-01T09:00:00Z");
    const s = await t.status();
    assert.deepEqual([s.state, s.readOnly, s.mode], ["evaluation_expired", false, "warn"]);
    assert.match(s.banners[0]!.message, /warning mode/);
    assert.equal((await t.write()).statusCode, 201);
    assert.equal((await t.write()).statusCode, 201);
    const would = (await t.licensing.history("installation")).filter((e) => e.type === "would_refuse");
    assert.equal(would.length, 1);
    assert.match(would[0]!.detail, /Would have refused POST \/api\/objects\/:class/);
  });

  it("SaaS: one licence per tenant, installed by the platform operator only", async () => {
    const t = await setup({ tenancy: true });
    const none = await t.status(t.users.admin);
    assert.equal(none.state, "evaluation_mode", "a SaaS tenant without a licence");
    const key = await t.issue();
    assert.equal((await t.install(key, t.users.admin)).statusCode, 403, "a tenant administrator cannot install");
    assert.equal((await t.install(key, t.users.operator)).statusCode, 200);
    assert.equal((await t.status(t.users.admin)).state, "valid");
    // Another tenant's key is refused.
    const globex = await t.issue({ binding: "tenant:globex" }, "ARC-2026-000999");
    assert.equal((await t.install(globex, t.users.operator)).statusCode, 400);
  });
});

describe("LICENSING=off", () => {
  it("does not load the module: no routes, nothing refused", async () => {
    const fake = new FakeItopClient();
    fake.on("core/create", (p) => getResponse([{ class: String(p["class"]), id: 99, fields: { name: "new" } }]));
    const schema = sampleSchema();
    const { app, services } = buildApp(testConfig(), { client: fake.asClient(), schema, navigation: sampleNavigation(schema), dashboards: sampleDashboards(fake.asClient(), schema) });
    after(() => app.close());
    assert.equal(services.licensing, undefined);
    assert.equal((await app.inject({ method: "GET", url: "/api/licence/status" })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/api/objects/Organization", payload: { fields: { name: "x" } } })).statusCode, 201);
  });
});
