import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LicenceDetail } from "../src/platform/licensing/index.js";
import { verifyDocument } from "../src/platform/licensing/sdk/index.js";
import type { UsageReport } from "../src/platform/licensing/usage.service.js";
import { code, licenceApp } from "./licence-app.js";

const detail = async (t: Awaited<ReturnType<typeof licenceApp>>, who = t.users.admin) =>
  (await t.send("GET", "/api/licence", who)).json() as LicenceDetail;

describe("the licence page", () => {
  it("shows the summary, usage against every limit and the history, to administrators only", async () => {
    const t = await licenceApp({ counts: { agents: 8, cis: 8200 } });
    await t.install(await t.issue({ order: { edition: "PRO", agents: 10 } }));
    const d = await detail(t);
    assert.equal(d.summary?.licenceId, "ARC-2026-000123");
    assert.equal(d.summary?.editionName, "Professional");
    assert.equal(d.deployment, "deployed");
    assert.equal(d.canInstall, true);
    assert.match(d.installation!.id, /^[0-9a-f-]{36}$/);
    assert.match(d.installation!.reportPublicKey, /BEGIN PUBLIC KEY/);
    const usage = Object.fromEntries(d.usage.map((r) => [r.metric, r]));
    assert.deepEqual([usage["agents"]!.used, usage["agents"]!.limit, usage["agents"]!.level], [8, 10, "warning"]);
    assert.deepEqual([usage["cis"]!.used, usage["cis"]!.limit, usage["cis"]!.percent], [8200, 10000, 82]);
    assert.equal(usage["storage"]!.limit, null, "deployed: storage not limited");
    assert.ok(d.history.some((e) => e.label === "Key installed" && e.actor === "admin"));
    assert.ok(d.history.some((e) => e.label === "Terms accepted"));
    assert.equal((await t.send("GET", "/api/licence", t.users.agent)).statusCode, 403);
  });

  it("LIC-17: on a deployed installation the first key is installed only with the EULA accepted, and it is recorded", async () => {
    const t = await licenceApp();
    const before = await detail(t);
    assert.equal(before.eula.required, true);
    assert.equal(before.eula.title, "End-user licence agreement");
    assert.match(before.eula.text, /^ARCUS END-USER LICENCE AGREEMENT\nVersion eula-/);
    assert.doesNotMatch(before.eula.text, /PLACEHOLDER/);
    const refused = await t.install(await t.issue(), t.users.admin, false, false);
    assert.equal(refused.statusCode, 400);
    assert.match((refused.json() as { error: { message: string } }).error.message, /Accept the end-user licence agreement/);
    assert.equal((await t.install(await t.issue())).statusCode, 200);
    const after = await detail(t);
    assert.deepEqual([after.eula.required, after.eula.acceptedBy], [false, "admin"]);
    // The next key needs no acceptance again.
    assert.equal((await t.install(await t.issue({ order: { agents: 20 } }, "ARC-2026-000200"), t.users.admin, false, false)).statusCode, 200);
  });

  it("a new agreement version is accepted again: banner, then the acceptance of the new version", async () => {
    const t = await licenceApp();
    await t.install(await t.issue());
    assert.equal((await detail(t)).eula.required, false);
    // As if the acceptance on record were for an earlier text.
    await t.store.acceptEula("installation", "admin", new Date("2026-12-01T09:00:00Z"), "eula-2026-01-01");
    await t.licensing.refresh();
    assert.deepEqual([(await detail(t)).eula.required, (await detail(t)).eula.outdated], [true, true]);
    const banner = (await t.status(t.users.admin)).banners.find((b) => b.kind === "eula");
    assert.match(banner?.message ?? "", /Accept the end-user licence agreement/);
    assert.equal((await t.send("POST", "/api/licence/eula", t.users.admin)).statusCode, 204);
    const d = await detail(t);
    assert.deepEqual([d.eula.required, d.eula.outdated, d.eula.acceptedBy], [false, false, "admin"]);
    assert.ok((await t.licensing.history("installation")).some((e) => e.type === "eula_accepted" && e.detail.includes(d.eula.version)));
  });

  it("LIC-17: in SaaS the tenant's first administrator accepts the terms; a banner asks until then", async () => {
    const t = await licenceApp({ tenancy: true });
    await t.install(await t.issue());
    const d = await detail(t);
    assert.deepEqual([d.deployment, d.canInstall, d.installation, d.eula.required], ["saas", false, null, true]);
    assert.equal(d.eula.title, "Terms of service");
    assert.match(d.eula.text, /^ARCUS TERMS OF SERVICE\nVersion saas-terms-/);
    assert.ok((await t.status(t.users.admin)).banners.some((b) => b.kind === "eula"));
    assert.equal((await t.send("POST", "/api/licence/eula", t.users.admin)).statusCode, 204);
    assert.equal((await detail(t)).eula.acceptedBy, "admin");
    assert.ok(!(await t.status(t.users.admin)).banners.some((b) => b.kind === "eula"));
    assert.equal((await t.send("POST", "/api/licence/eula", t.users.agent)).statusCode, 403);
  });

  it("LT-15: the usage report is signed by the installation and verifies with its registered key; an edit fails", async () => {
    const t = await licenceApp({ counts: { agents: 6, cis: 900 } });
    await t.install(await t.issue({ order: { edition: "PRO", agents: 10 } }));
    await t.status(t.users.admin); // measures today's counts
    await t.usage.recordUsage("installation", "ai_actions", 12);
    const res = await t.send("GET", "/api/licence/usage-report?from=2026-12-01&to=2026-12-31", t.users.admin);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-disposition"]), /arcus-usage-installation-2026-12-01-2026-12-31\.json/);
    const publicKeyPem = (await detail(t)).installation!.reportPublicKey;
    const check = verifyDocument<UsageReport>(res.body, { kind: "usage_report", publicKeyPem });
    assert.equal(check.ok, true);
    const report = check.ok ? check.document.payload : undefined;
    assert.equal(report?.licence_id, "ARC-2026-000123");
    assert.deepEqual(report?.limits, { agents: 10, sessions: 10, cis: 10000, ai_actions: 3000, storage: null });
    assert.deepEqual([report?.days[0]?.agents, report?.days[0]?.cis, report?.peaks.ai_actions_in_a_month], [6, 900, 12]);
    assert.equal(verifyDocument(res.body.replace('"cis":900', '"cis":90'), { kind: "usage_report", publicKeyPem }).ok, false);
    assert.equal(code(await t.send("GET", "/api/licence/usage-report?from=2026-12-31&to=2026-12-01", t.users.admin)), "bad_request");
  });
});
