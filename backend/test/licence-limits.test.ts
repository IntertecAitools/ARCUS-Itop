import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { Caller } from "../src/core/request-context.js";
import { SignInFlow } from "../src/platform/auth/sign-in.flow.js";
import { hardCap } from "../src/platform/licensing/index.js";
import { CmdbSchema } from "../src/schema/load.js";
import { getResponse, type FakeItopClient } from "./helpers.js";
import { code, licenceApp } from "./licence-app.js";

const realSchema = CmdbSchema.fromFile(resolve(import.meta.dirname, "..", "..", "cmdb-schema", "cmdb-schema.json"));

/** Profiles and accounts, enough for the users service. */
function accounts(fake: FakeItopClient) {
  fake.on("core/get", (p) => {
    switch (p["class"]) {
      case "URP_Profiles":
        return getResponse([
          { class: "URP_Profiles", id: 1, fields: { name: "Administrator", description: "" } },
          { class: "URP_Profiles", id: 2, fields: { name: "Portal user", description: "" } },
          { class: "URP_Profiles", id: 5, fields: { name: "Service Desk Agent", description: "" } },
          { class: "URP_Profiles", id: 9, fields: { name: "REST Services User", description: "" } },
        ]);
      case "User":
      case "UserLocal":
        return getResponse([{ class: "UserLocal", id: 20, fields: { login: "bob", status: "disabled", contactid: "4" } }]);
      case "URP_UserProfile":
        return getResponse([{ class: "URP_UserProfile", id: 1, fields: { userid: 20, profileid: 5, profile: "Service Desk Agent" } }]);
      default:
        return getResponse([{ class: "Organization", id: 1, fields: { name: "HQ", status: "active", parent_id: 0 } }]);
    }
  });
  fake.on("core/update", getResponse([{ class: "UserLocal", id: 20, fields: {} }]));
}

const newAgent = { type: "local", login: "newbie", password: "long-enough", contact: { id: 4 }, profileIds: [5] };
const newRequester = { ...newAgent, login: "pat", profileIds: [2] };

describe("limits", () => {
  it("allows 10% over a limit, then pauses new use", () => {
    assert.equal(hardCap(60), 66);
    assert.equal(hardCap(5000), 5500);
    assert.equal(hardCap(0), 0);
  });

  it("LT-03: one agent beyond named seats (plus 10%) is refused; existing agents are unaffected", async () => {
    const t = await licenceApp({ itop: accounts, counts: { agents: 10, cis: 0 } });
    await t.install(await t.issue({ order: { agents: 10 } })); // cap 11
    // 10 in use: the 11th is within the 10% allowance.
    assert.notEqual(code(await t.send("POST", "/api/admin/users", t.users.admin, newAgent)), "LICENCE_LIMIT");
    t.counts.agents = 11;
    const refused = await t.send("POST", "/api/admin/users", t.users.admin, newAgent);
    assert.equal(refused.statusCode, 403);
    assert.equal(code(refused), "LICENCE_LIMIT");
    assert.match((refused.json() as { error: { message: string } }).error.message, /All 10 agent seats are in use/);
    assert.deepEqual((refused.json() as { error: { details: unknown } }).error.details, { metric: "agents", used: 11, limit: 10 });
    // Enabling a disabled agent takes a seat too.
    assert.equal(code(await t.send("PATCH", "/api/admin/users/20", t.users.admin, { status: "enabled" })), "LICENCE_LIMIT");
    // A requester is never counted; existing agents work on.
    assert.notEqual(code(await t.send("POST", "/api/admin/users", t.users.admin, newRequester)), "LICENCE_LIMIT");
    assert.equal((await t.write(t.users.agent)).statusCode, 201);
    const events = await t.licensing.history("installation");
    assert.ok(events.some((e) => e.type === "refused" && /agent seats/.test(e.detail)));
  });

  it("LT-04: more agent sessions than seats are refused at sign-in; signing out frees one", async () => {
    const t = await licenceApp({ counts: { agents: 0, cis: 0 } });
    // 3 sessions, cap 3. The administrator who installs it holds an agent profile: one session in use.
    await t.install(await t.issue({ order: { agents: 3, concurrentSeats: 0 } }));
    const flow = new SignInFlow(t.services);
    const agent = (login: string): Caller => ({
      userId: login.length + 100, login, contactId: 0, name: login, email: "", kind: "staff",
      profiles: ["Service Desk Agent"], isAdmin: false, allowedOrgIds: [], orgId: 10, credentials: { user: login, password: "pw" },
    });
    const request = { host: "app.test", ip: "127.0.0.1", headers: {} } as never;
    const reply = { header: () => reply } as never;
    await flow.complete(request, reply, agent("a1"), undefined, undefined);
    await flow.complete(request, reply, agent("a2"), undefined, undefined);
    await assert.rejects(flow.complete(request, reply, agent("a3"), undefined, undefined), (err: { code?: string; message: string }) => {
      assert.equal(err.code, "LICENCE_LIMIT");
      assert.match(err.message, /All 3 agent sessions are in use/);
      return true;
    });
    // Someone already signed in signs in again from another browser: not a new session.
    await flow.complete(request, reply, agent("a1"), undefined, undefined);
    // A requester is never counted.
    await flow.complete(request, reply, { ...agent("pat"), kind: "portal", profiles: ["Portal user"] }, undefined, undefined);
    // a2 signs out; a3 gets in.
    t.usage.forget("installation", "a2");
    await flow.complete(request, reply, agent("a3"), undefined, undefined);
    // Quiet for 15 minutes counts as gone.
    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    await flow.complete(request, reply, agent("a4"), undefined, undefined);
  });

  it("LT-05: warnings at 80% and 100% of the CI limit; new CIs pause above 110%", async () => {
    const t = await licenceApp({ schema: realSchema, counts: { agents: 0, cis: 3999 } });
    await t.install(await t.issue({ order: { edition: "PRO" } })); // 5,000 CIs, cap 5,500
    const createServer = () => t.send("POST", "/api/objects/Server", t.users.agent, { fields: { name: "srv-1", org_id: 1 } });
    const importServers = () => t.send("POST", "/api/admin/data-import/Server/run", t.users.admin, { rows: [] });

    assert.notEqual(code(await createServer()), "LICENCE_LIMIT");
    t.counts.cis = 4000; // 80%
    assert.notEqual(code(await createServer()), "LICENCE_LIMIT");
    let banners = (await t.status(t.users.admin)).banners.filter((b) => b.kind === "limit");
    assert.match(banners[0]!.message, /Configuration items: 4000 of 5000 in use \(80%\)/);
    assert.equal((await t.status(t.users.agent)).banners.filter((b) => b.kind === "limit").length, 0, "limit banners are for administrators");

    t.counts.cis = 5000; // 100%
    assert.notEqual(code(await createServer()), "LICENCE_LIMIT");
    banners = (await t.status(t.users.admin)).banners.filter((b) => b.kind === "limit");
    assert.match(banners[0]!.message, /Up to 10% more is allowed/);

    t.counts.cis = 5500; // the 10% is used up
    const refused = await createServer();
    assert.equal(code(refused), "LICENCE_LIMIT");
    assert.match((refused.json() as { error: { message: string } }).error.message, /5000 configuration items; new ones are paused/);
    assert.equal(code(await importServers()), "LICENCE_LIMIT", "imports pause too");
    // Editing an existing CI, and records that are not CIs, still work.
    assert.notEqual(code(await t.send("PATCH", "/api/objects/Server/12", t.users.agent, { fields: { name: "renamed" } })), "LICENCE_LIMIT");
    assert.notEqual(code(await t.send("POST", "/api/objects/UserRequest", t.users.agent, { fields: { title: "x" } })), "LICENCE_LIMIT");

    const events = await t.licensing.history("installation");
    const warnings = events.filter((e) => e.type === "limit_warning").map((e) => e.detail);
    assert.ok(warnings.some((d) => /Configuration items at 80%/.test(d)));
    assert.ok(warnings.some((d) => /Configuration items at 100%/.test(d)));
    assert.equal(warnings.filter((d) => /at 80%/.test(d)).length, 1, "recorded once a day, not on every request");
  });

  it("LT-05: synchronised sources (Enterprise) pause with the CIs too", async () => {
    const t = await licenceApp({ schema: realSchema, counts: { agents: 0, cis: 27_501 } });
    await t.install(await t.issue({ order: { edition: "ENT" } })); // 25,000 CIs, cap 27,500
    assert.equal(code(await t.send("POST", "/api/admin/data-import/sync-sources/3/run", t.users.admin, {})), "LICENCE_LIMIT");
  });

  it("AI actions pause when the month's allowance (plus 10%) is used, and count only when the AI answered", async () => {
    const t = await licenceApp();
    await t.install(await t.issue({ order: { edition: "PRO", agents: 10 } })); // 3,000 a month
    await t.usage.recordUsage("installation", "ai_actions", 3300);
    const refused = await t.send("POST", "/api/problems/1/rca-draft", t.users.agent, {});
    assert.equal(code(refused), "LICENCE_LIMIT");
    assert.match((refused.json() as { error: { message: string } }).error.message, /3000 AI actions are used up/);
    // Next month the allowance is back.
    await t.advanceTo("2027-01-01T09:00:00Z");
    assert.notEqual(code(await t.send("POST", "/api/problems/1/rca-draft", t.users.agent, {})), "LICENCE_LIMIT");
  });

  it("LICENSING=warn records the refusal and lets it through", async () => {
    const t = await licenceApp({ mode: "warn", itop: accounts, counts: { agents: 50, cis: 0 } });
    await t.install(await t.issue({ order: { agents: 10 } }));
    assert.notEqual(code(await t.send("POST", "/api/admin/users", t.users.admin, newAgent)), "LICENCE_LIMIT");
    assert.ok((await t.licensing.history("installation")).some((e) => e.type === "would_refuse" && /agent seats/.test(e.detail)));
  });

  it("keeps daily figures: today's counts, the peak of sessions and AI actions", async () => {
    const t = await licenceApp({ counts: { agents: 7, cis: 120 } });
    await t.install(await t.issue());
    await t.status(t.users.admin); // the banners measure the counts
    await t.send("GET", "/api/objects/Organization", t.users.agent); // an agent session
    await t.usage.recordUsage("installation", "ai_actions", 4);
    await t.usage.snapshot();
    const [day] = await t.usage.days("installation", "2026-12-01", "2026-12-01");
    assert.deepEqual(
      { agents: day!.agents, cis: day!.cis, peakSessions: day!.peakSessions, aiActions: day!.aiActions },
      { agents: 7, cis: 120, peakSessions: 2, aiActions: 4 }, // the administrator and the agent
    );
    const rows = await t.usage.usage("installation");
    assert.deepEqual(rows.map((r) => r.metric), ["agents", "sessions", "cis", "ai_actions", "storage"]);
  });
});
