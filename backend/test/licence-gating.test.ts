import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { modules } from "../src/config/modules.js";
import { EDITION_FEATURES, featureOfClass, featureOfRoute, FEATURES } from "../src/platform/licensing/editions.js";
import { CmdbSchema } from "../src/schema/load.js";
import { code, licenceApp } from "./licence-app.js";

const realSchema = CmdbSchema.fromFile(resolve(import.meta.dirname, "..", "..", "cmdb-schema", "cmdb-schema.json"));

const moduleIds = async (t: Awaited<ReturnType<typeof licenceApp>>) =>
  ((await t.send("GET", "/api/meta/modules", t.users.agent)).json() as { modules: { id: string }[] }).modules.map((m) => m.id);

describe("edition gating tables", () => {
  it("every backend module names a known feature", () => {
    for (const m of modules) assert.ok(FEATURES.includes(m.feature), `${m.id}: ${m.feature}`);
  });

  it("maps platform routes before module routes, and the AI draft to ai", () => {
    assert.equal(featureOfRoute("/api/problems/:id/rca-draft", "problem"), "ai");
    assert.equal(featureOfRoute("/api/problems/:id/analysis", "problem"), "problem");
    assert.equal(featureOfRoute("/api/admin/audit/rules/:id"), "audit_sync");
    assert.equal(featureOfRoute("/api/queries/run"), "analytics");
    assert.equal(featureOfRoute("/api/request-forms/resolve", "approvals_forms"), "service_desk");
    assert.equal(featureOfRoute("/api/objects/:class"), undefined, "door 3 decides by class");
    assert.equal(featureOfRoute("/api/queriesx"), undefined, "a prefix matches whole segments only");
  });

  it("gives every subclass of Change to change, and leaves tickets and CIs alone", () => {
    for (const c of ["Change", "NormalChange", "RoutineChange", "EmergencyChange", "ApprovedChange"]) {
      assert.equal(featureOfClass(realSchema.lineage(c)), "change", c);
    }
    assert.equal(featureOfClass(realSchema.lineage("KnownError")), "problem");
    assert.equal(featureOfClass(realSchema.lineage("UserRequest")), undefined);
    assert.equal(featureOfClass(realSchema.lineage("Server")), undefined);
  });
});

describe("LT-01: an Essentials key shows only Essentials in the API", () => {
  it("leaves PRO modules out of GET /api/meta/modules and refuses them by every door", async () => {
    const t = await licenceApp();
    await t.install(await t.issue({ order: { edition: "ESS" } }));
    const status = await t.status();
    assert.deepEqual(status.features, [...EDITION_FEATURES.ESS]);

    const ids = await moduleIds(t);
    assert.ok(ids.includes("incidents"));
    for (const gated of ["changes", "problems", "request-forms"]) assert.ok(!ids.includes(gated), gated);

    // Door 1: a business module.
    const cab = await t.send("GET", "/api/changes/cab", t.users.agent);
    assert.equal(cab.statusCode, 403);
    assert.equal(code(cab), "LICENCE_FEATURE");
    assert.deepEqual((cab.json() as { error: { details: unknown } }).error.details, { feature: "change", edition: "ESS", includedIn: "PRO" });
    assert.match((cab.json() as { error: { message: string } }).error.message, /not included in your edition \(Essentials\).*Professional/);
    // Door 2: platform routes.
    assert.equal(code(await t.send("GET", "/api/queries", t.users.agent)), "LICENCE_FEATURE");
    assert.equal(code(await t.send("GET", "/api/admin/audit", t.users.admin)), "LICENCE_FEATURE");
    // Door 3: the record class through the generic screens.
    for (const url of ["/api/objects/Change", "/api/objects/Change/12", "/api/objects/Problem/export?format=csv", "/api/meta/classes/Change", "/api/lookups/KnownError"]) {
      assert.equal(code(await t.send("GET", url, t.users.agent)), "LICENCE_FEATURE", url);
    }
    assert.equal(code(await t.send("POST", "/api/objects/Change", t.users.agent, { fields: { title: "x" } })), "LICENCE_FEATURE");
    // Nothing held hostage: an administrator can still export the hidden records.
    assert.notEqual(code(await t.send("GET", "/api/objects/Problem/export?format=csv", t.users.admin)), "LICENCE_FEATURE");
    // What Essentials has still answers.
    assert.equal((await t.send("GET", "/api/objects/Organization", t.users.agent)).statusCode, 200);
    // Requesters are never gated.
    assert.notEqual(code(await t.send("GET", "/api/me/approvals/count", t.users.requester)), "LICENCE_FEATURE");
    assert.ok((await t.licensing.history("installation")).some((e) => e.type === "refused" && /change is not in the edition/.test(e.detail)));
  });

  it("checks a saved query's record type too", async () => {
    const t = await licenceApp();
    await t.install(await t.issue({ order: { edition: "PRO" } }));
    const run = await t.send("POST", "/api/queries/run", t.users.agent, { query: { name: "", recordType: "AuditRule" } });
    assert.equal(code(run), "LICENCE_FEATURE");
    assert.deepEqual((run.json() as { error: { details: { feature: string } } }).error.details.feature, "audit_sync");
  });

  it("with LICENSING=warn hides nothing and refuses nothing, but records it", async () => {
    const t = await licenceApp({ mode: "warn" });
    await t.install(await t.issue({ order: { edition: "ESS" } }));
    assert.ok((await moduleIds(t)).includes("changes"));
    assert.notEqual(code(await t.send("GET", "/api/objects/Change", t.users.agent)), "LICENCE_FEATURE");
    assert.ok((await t.licensing.history("installation")).some((e) => e.type === "would_refuse" && /change/.test(e.detail)));
  });
});

describe("LT-02: a better key adds modules within minutes, with no restart", () => {
  it("ESS, then PRO, then ENT saved on another instance: the next minute's refresh applies each", async () => {
    const t = await licenceApp();
    await t.install(await t.issue({ order: { edition: "ESS" } }, "ARC-2026-000001"));
    assert.ok(!(await moduleIds(t)).includes("changes"));

    // Saved by another BFF instance: this one learns of it at its next refresh.
    await t.store.addLicence("installation", await t.issue({ order: { edition: "PRO" } }, "ARC-2026-000002"), "admin", t.clock.now);
    assert.ok(!(await moduleIds(t)).includes("changes"), "not before the refresh");
    await t.advanceTo("2026-12-01T09:01:00Z");
    assert.ok((await moduleIds(t)).includes("changes"));
    assert.notEqual(code(await t.send("GET", "/api/changes/cab", t.users.agent)), "LICENCE_FEATURE");
    assert.equal(code(await t.send("GET", "/api/admin/audit", t.users.admin)), "LICENCE_FEATURE");

    await t.store.addLicence("installation", await t.issue({ order: { edition: "ENT" } }, "ARC-2026-000003"), "admin", t.clock.now);
    await t.advanceTo("2026-12-01T09:02:00Z");
    assert.equal((await t.status()).edition, "ENT");
    assert.notEqual(code(await t.send("GET", "/api/admin/audit", t.users.admin)), "LICENCE_FEATURE");
  });
});
