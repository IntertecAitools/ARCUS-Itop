import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { runAs, type Caller, type TenantScope } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import { MemorySessionStore } from "../src/platform/auth/session.store.js";
import { itemClassOf, scopeOql, selectedClassOf, splitUnion } from "../src/platform/tenancy/oql-scope.js";
import { TenantResolver, tenantOfUser } from "../src/platform/tenancy/resolve.js";
import { ScopeRules } from "../src/platform/tenancy/scope-rules.js";
import { keyToOql, TenantScopedClient } from "../src/platform/tenancy/scoped-client.js";
import { MemoryTenantStore, type Tenant } from "../src/platform/tenancy/tenant.store.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, testConfig } from "./helpers.js";

const SCHEMA_DIR = resolve(import.meta.dirname, "..", "..", "cmdb-schema");
const schema = CmdbSchema.fromFile(resolve(SCHEMA_DIR, "cmdb-schema.json"));
const rules = new ScopeRules(schema);

/** Tenant A owns organisations 10 and 11, tenant B owns 20. */
const TENANTS: Tenant[] = [
  { id: "acme", name: "Acme", status: "active", domains: ["acme.test"], orgIds: [10, 11] },
  { id: "globex", name: "Globex", status: "active", domains: ["globex.test"], orgIds: [20] },
  { id: "dormant", name: "Dormant", status: "disabled", domains: ["dormant.test"], orgIds: [30] },
];
const A: TenantScope = { id: "acme", name: "Acme", orgIds: [10, 11] };

function staff(login: string, orgId: number, extra: Partial<Caller> = {}): Caller {
  return {
    userId: orgId * 10,
    login,
    contactId: orgId * 10 + 1,
    name: login,
    email: "",
    kind: "staff",
    profiles: ["Administrator"],
    isAdmin: true,
    allowedOrgIds: [],
    orgId,
    credentials: { user: login, password: "pw" },
    ...extra,
  };
}

describe("scope rules", () => {
  it("follows iTop's silos: Organization by id, the rest by org_id", () => {
    assert.deepEqual(rules.ruleFor("Organization"), { kind: "org", attr: "id" });
    assert.deepEqual(rules.ruleFor("UserRequest"), { kind: "org", attr: "org_id" });
    assert.deepEqual(rules.ruleFor("Person"), { kind: "org", attr: "org_id" });
    assert.equal(rules.ruleFor("Server").kind, "org");
  });

  it("scopes link rows by every key they hold", () => {
    const rule = rules.ruleFor("lnkContactToTicket");
    assert.equal(rule.kind, "keys");
    assert.deepEqual(rule.kind === "keys" && rule.keys.map((k) => k.attr).sort(), ["contact_id", "ticket_id"]);
  });

  it("knows accounts, attachments, saved queries, history and notifications", () => {
    assert.equal(rules.ruleFor("UserLocal").kind, "org");
    assert.deepEqual(rules.ruleFor("Attachment").kind === "org" && rules.ruleFor("Attachment"), {
      kind: "org",
      attr: "item_org_id",
      write: { via: "item", classAttr: "item_class", idAttr: "item_id" },
    });
    assert.equal(rules.ruleFor("QueryOQL").kind, "keys");
    assert.equal(rules.ruleFor("CMDBChangeOpSetAttributeScalar").kind, "polymorphic");
    assert.equal(rules.ruleFor("TriggerOnObjectCreate").kind, "platform");
    assert.equal(rules.ruleFor("EventNotificationEmail").kind, "platform");
    assert.equal(rules.ruleFor("EventNotificationNewsroom").kind, "keys");
  });

  it("shares reference data and closes anything it does not know", () => {
    assert.equal(rules.ruleFor("Brand").kind, "shared");
    assert.equal(rules.ruleFor("FAQ").kind, "shared");
    assert.equal(rules.ruleFor("URP_Profiles").kind, "shared");
    assert.equal(rules.ruleFor("NoSuchClass").kind, "platform");
  });
});

describe("OQL scoping", () => {
  it("wraps any query so it can only return the tenant's records", () => {
    assert.equal(
      scopeOql("SELECT UserRequest WHERE status = 'new'", rules, [10, 11]),
      "SELECT UserRequest WHERE id IN (SELECT UserRequest WHERE status = 'new') AND UserRequest.org_id IN (10,11)",
    );
    assert.equal(
      scopeOql("SELECT o FROM Organization AS o", rules, [10]),
      "SELECT Organization WHERE id IN (SELECT o FROM Organization AS o) AND Organization.id IN (10)",
    );
  });

  it("scopes each part of a union", () => {
    const out = scopeOql("SELECT Person WHERE id = 1 UNION SELECT Person WHERE id = 2", rules, [10]);
    assert.equal(splitUnion(out).length, 2);
    for (const part of splitUnion(out)) assert.match(part, /^SELECT Person WHERE id IN \(.*\) AND Person.org_id IN \(10\)$/);
  });

  it("does not split a union inside a string or a subquery", () => {
    assert.equal(splitUnion("SELECT FAQ WHERE title = 'a UNION b'").length, 1);
    assert.equal(splitUnion("SELECT FAQ WHERE id IN (SELECT FAQ UNION SELECT FAQ)").length, 1);
  });

  it("leaves shared data alone and empties a tenant with no organisations", () => {
    assert.equal(scopeOql("SELECT Brand", rules, [10]), "SELECT Brand");
    assert.match(scopeOql("SELECT Person", rules, []), /Person.org_id IN \(-1\)$/);
  });

  it("pins history to one class, even if the query tries to name it in a string", () => {
    assert.equal(itemClassOf("SELECT CMDBChangeOp WHERE objclass = 'UserRequest' AND objkey = 5", "objclass"), "UserRequest");
    const sneaky = scopeOql(`SELECT CMDBChangeOp WHERE userinfo = "objclass = 'Brand'" AND objkey = 5`, rules, [10]);
    assert.match(sneaky, /AND CMDBChangeOp.objclass = 'Brand'$/);
    assert.throws(() => scopeOql("SELECT CMDBChangeOp WHERE objkey = 5", rules, [10]), /one kind of record/);
    assert.match(
      scopeOql("SELECT CMDBChangeOp WHERE objclass = 'UserRequest' AND objkey = 5", rules, [10]),
      /CMDBChangeOp.objclass = 'UserRequest' AND CMDBChangeOp.objkey IN \(SELECT UserRequest AS ts_1 WHERE ts_1.org_id IN \(10\)\)$/,
    );
  });

  it("refuses what it cannot check", () => {
    assert.equal(selectedClassOf("SELECT a, b FROM Person AS a JOIN Organization AS b ON a.org_id = b.id"), null);
    assert.throws(() => scopeOql("SELECT a, b FROM Person AS a JOIN Organization AS b ON a.org_id = b.id", rules, [10]));
    assert.throws(() => scopeOql("SELECT TriggerOnObjectCreate", rules, [10]), /platform operator/);
  });

  it("makes saved queries without an owner shared, and only owned ones writable", () => {
    assert.match(scopeOql("SELECT QueryOQL", rules, [10]), /\(QueryOQL.owner_id = 0 OR QueryOQL.owner_id IN \(SELECT Contact AS ts_1 WHERE ts_1.org_id IN \(10\)\)\)$/);
    assert.match(scopeOql("SELECT QueryOQL WHERE id = 3", rules, [10], true), /AND \(QueryOQL.owner_id > 0\)$/);
    assert.throws(() => scopeOql("SELECT Brand WHERE id = 1", rules, [10], true), /shared/);
  });

  it("turns every REST key form into OQL", () => {
    assert.equal(keyToOql("Person", 5), "SELECT Person WHERE id = 5");
    assert.equal(keyToOql("Person", "7"), "SELECT Person WHERE id = 7");
    assert.equal(keyToOql("Person", { name: "O'Neil", finalclass: "Person" }), "SELECT Person WHERE name = 'O\\'Neil'");
    assert.throws(() => keyToOql("Person", { org_id: { name: "x" } }), /nested criteria/);
  });
});

describe("tenant resolution", () => {
  const resolver = new TenantResolver(new MemoryTenantStore(TENANTS), { enabled: true, platformLogins: ["root"] });

  it("finds a user's tenant from their organisation, else their allowed ones", () => {
    assert.equal(tenantOfUser({ login: "a", orgId: 11, allowedOrgIds: [] }, TENANTS)?.id, "acme");
    assert.equal(tenantOfUser({ login: "a", orgId: 0, allowedOrgIds: [10, 11] }, TENANTS)?.id, "acme");
    assert.equal(tenantOfUser({ login: "a", orgId: 0, allowedOrgIds: [10, 20] }, TENANTS), undefined);
    assert.equal(tenantOfUser({ login: "a", orgId: 99, allowedOrgIds: [] }, TENANTS), undefined);
  });

  it("scopes to the user's tenant, wherever they sign in from", async () => {
    assert.deepEqual((await resolver.resolve("app.example:443", staff("ann", 10))).tenant, A);
    assert.deepEqual((await resolver.resolve("acme.test", staff("ann", 10))).tenant, A);
  });

  it("refuses a user on another tenant's domain, an orphan, and a disabled tenant", async () => {
    assert.match(String((await resolver.resolve("globex.test", staff("ann", 10))).refused?.message), /another site/);
    assert.match(String((await resolver.resolve("app.example", staff("ann", 99))).refused?.message), /not linked/);
    assert.ok((await resolver.resolve("app.example", staff("dee", 30))).refused);
    assert.ok((await resolver.resolve("dormant.test", undefined)).refused);
  });

  it("leaves a platform operator unscoped on the platform, scoped on a tenant's domain", async () => {
    assert.equal((await resolver.resolve("app.example", staff("root", 99))).tenant, undefined);
    assert.equal((await resolver.resolve("globex.test", staff("root", 99))).tenant?.id, "globex");
  });

  it("does nothing with tenancy off", async () => {
    const off = new TenantResolver(new MemoryTenantStore(TENANTS), { enabled: false, platformLogins: [] });
    assert.deepEqual(await off.resolve("globex.test", staff("ann", 10)), {});
  });

  it("keeps an organisation and a domain to one tenant", () => {
    assert.throws(
      () => new MemoryTenantStore([...TENANTS, { id: "dup", name: "Dup", status: "active", domains: [], orgIds: [20] }]),
      /belongs to both/,
    );
  });
});

// ---------------------------------------------------------------------------
// A small iTop: enough OQL to answer the queries the guard sends, over a data
// set with two tenants, so the routes can be driven end to end.

interface Row {
  class: string;
  id: number;
  org: number;
  fields?: Record<string, unknown>;
}

const DATA: Row[] = [
  { class: "Organization", id: 10, org: 10, fields: { name: "Acme HQ" } },
  { class: "Organization", id: 11, org: 11, fields: { name: "Acme Labs" } },
  { class: "Organization", id: 20, org: 20, fields: { name: "Globex" } },
  { class: "UserRequest", id: 100, org: 10, fields: { ref: "R-100", title: "Acme printer" } },
  { class: "UserRequest", id: 101, org: 11, fields: { ref: "R-101", title: "Acme lab VPN" } },
  { class: "UserRequest", id: 200, org: 20, fields: { ref: "R-200", title: "Globex secret" } },
  { class: "Person", id: 101, org: 10, fields: { name: "Ann" } },
  { class: "Person", id: 201, org: 20, fields: { name: "Gus" } },
];

const SUBCLASSES: Record<string, string[]> = { Ticket: ["UserRequest"], Contact: ["Person"], FunctionalCI: [] };

function classMatches(rowClass: string, cls: string): boolean {
  return rowClass === cls || (SUBCLASSES[cls] ?? []).includes(rowClass);
}

/** The rows an OQL text returns, for the shapes the BFF and the guard produce. */
function evaluate(oql: string): Row[] {
  const scoped = /^SELECT (\w+) WHERE id IN \((.*)\) AND \w+\.(org_id|id) IN \(([-\d,]+)\)$/s.exec(oql.trim());
  if (scoped) {
    const orgs = scoped[4]!.split(",").map(Number);
    return evaluate(scoped[2]!).filter((r) => classMatches(r.class, scoped[1]!) && orgs.includes(r.org));
  }
  const head = /^SELECT (\w+)(?: AS \w+)?(?: WHERE (.*))?$/s.exec(oql.trim());
  if (!head) return [];
  let rows = DATA.filter((r) => classMatches(r.class, head[1]!));
  const where = head[2] ?? "";
  const id = /^id = (\d+)$/.exec(where);
  if (id) rows = rows.filter((r) => r.id === Number(id[1]));
  const ids = /^id IN \(([\d,]+)\)$/.exec(where);
  if (ids) rows = rows.filter((r) => ids[1]!.split(",").map(Number).includes(r.id));
  return rows;
}

function asResult(rows: Row[]): ItopResult {
  return getResponse(rows.map((r) => ({ class: r.class, id: r.id, fields: { id: String(r.id), org_id: String(r.org), ...r.fields } })));
}

class MiniItop extends FakeItopClient {
  readonly scripts: Array<{ script: string; params: Record<string, string> }> = [];

  constructor() {
    super();
    this.on("core/get", (p) => asResult(evaluate(String(typeof p["key"] === "number" ? `SELECT ${p["class"]} WHERE id = ${p["key"]}` : p["key"]))));
    const write = (p: Record<string, unknown>): ItopResult => {
      const rows = evaluate(String(p["key"]));
      if (rows.length !== 1) return { code: 100, message: `No item found with criteria: ${String(p["key"])}` };
      return asResult(rows);
    };
    this.on("core/update", write);
    this.on("core/apply_stimulus", write);
    this.on("core/delete", (p) => {
      const rows = evaluate(String(p["key"]));
      return { code: 0, message: "Deleted", objects: asResult(rows).objects } as ItopResult;
    });
    this.on("core/create", (p) =>
      getResponse([{ class: String(p["class"]), id: 999, fields: { id: "999", ...(p["fields"] as Record<string, unknown>) } }]),
    );
    this.on("core/get_related", () => ({
      code: 0,
      message: "",
      objects: asResult(DATA.filter((r) => r.class === "UserRequest")).objects,
      relations: { "UserRequest::100": [{ key: "UserRequest::200" }, { key: "UserRequest::101" }] },
    }) as ItopResult);
  }

  async postScript(script: string, params: Record<string, string>): Promise<Response> {
    this.scripts.push({ script, params });
    return new Response("id,org\n", { headers: { "content-disposition": "attachment; filename=x.csv", "content-type": "text/csv" } });
  }
}

async function setup() {
  const fake = new MiniItop();
  const sessions = new MemorySessionStore(3_600_000, 3_600_000);
  const config = testConfig({
    navigationPath: resolve(SCHEMA_DIR, "cmdb-navigation.json"),
    dashboardsPath: resolve(SCHEMA_DIR, "cmdb-dashboards.json"),
    auth: { required: true, sessionIdleMs: 3_600_000, sessionMaxMs: 3_600_000, cookieSecure: false, sessionStore: { kind: "memory" } },
  });
  const { app } = buildApp(
    { ...config, tenancy: { enabled: true, platformLogins: ["root"] } },
    { client: fake.asClient(), schema, sessions, resetTokens: undefined, tenants: new MemoryTenantStore(TENANTS) },
  );
  after(async () => {
    await app.close();
  });
  const cookieFor = async (caller: Caller) => `intertec_sid=${await sessions.create(caller)}`;
  return { app, fake, ann: await cookieFor(staff("ann", 10)), gus: await cookieFor(staff("gus", 20)), root: await cookieFor(staff("root", 1)) };
}

describe("cross-tenant leaks (routes, end to end over a small iTop)", async () => {
  const { app, fake, ann, gus, root } = await setup();
  const get = (url: string, cookie: string, host = "app.example") =>
    app.inject({ method: "GET", url, headers: { cookie, host } });

  it("lists only the tenant's own records", async () => {
    const res = await get("/api/objects/UserRequest", ann);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().items.map((i: { id: number }) => i.id).sort(), [100, 101]);
    const theirs = await get("/api/objects/UserRequest", gus);
    assert.deepEqual(theirs.json().items.map((i: { id: number }) => i.id), [200]);
  });

  it("cannot read another tenant's record by guessing its id", async () => {
    assert.equal((await get("/api/objects/UserRequest/200", ann)).statusCode, 404);
    assert.equal((await get("/api/objects/Ticket/200", ann)).statusCode, 404);
    assert.equal((await get("/api/objects/Organization/20", ann)).statusCode, 404);
    assert.equal((await get("/api/objects/UserRequest/100", ann)).statusCode, 200);
  });

  it("cannot reach it through a filter or a search either", async () => {
    for (const url of ["/api/objects/UserRequest?ref=R-200", "/api/objects/UserRequest?q=Globex"]) {
      const res = await get(url, ann);
      assert.equal(res.statusCode, 200);
      assert.ok(!res.json().items.some((i: { id: number }) => i.id === 200), url);
    }
  });

  it("cannot update, transition or delete another tenant's record", async () => {
    const patch = await app.inject({ method: "PATCH", url: "/api/objects/UserRequest/200", headers: { cookie: ann, host: "app.example" }, payload: { fields: { title: "pwned" } } });
    assert.equal(patch.statusCode, 404);
    const del = await app.inject({ method: "DELETE", url: "/api/objects/UserRequest/200", headers: { cookie: ann, host: "app.example" } });
    assert.equal(del.statusCode, 404);
    const deletes = fake.calls.filter((c) => c.verb === "core/delete");
    for (const c of deletes) assert.match(String(c.params["key"]), /org_id IN \(10,11\)/);
  });

  it("cannot create a record in, or point a key at, another tenant's organisation", async () => {
    const create = (fields: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/objects/UserRequest", headers: { cookie: ann, host: "app.example" }, payload: { fields } });
    const intoB = await create({ title: "x", description: "x", org_id: 20, caller_id: 101 });
    assert.equal(intoB.statusCode, 400);
    assert.match(intoB.json().error.message, /org_id/);
    const callerB = await create({ title: "x", description: "x", org_id: 10, caller_id: 201 });
    assert.equal(callerB.statusCode, 400);
    assert.match(callerB.json().error.message, /caller_id/);
    const ok = await create({ title: "x", description: "x", org_id: 10, caller_id: 101 });
    assert.equal(ok.statusCode, 201);
  });

  it("cannot move a record of its own into another tenant", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/objects/UserRequest/100", headers: { cookie: ann, host: "app.example" }, payload: { fields: { org_id: 20 } } });
    assert.equal(res.statusCode, 400);
  });

  it("exports only the tenant's records", async () => {
    const res = await get("/api/objects/UserRequest/export?format=csv", ann);
    assert.equal(res.statusCode, 200);
    const expression = fake.scripts.at(-1)!.params["expression"]!;
    assert.match(expression, /^SELECT UserRequest WHERE id IN \(.*\) AND UserRequest.org_id IN \(10,11\)$/s);
  });

  it("refuses the history of another tenant's record", async () => {
    assert.equal((await get("/api/objects/UserRequest/200/history", ann)).statusCode, 404);
  });

  it("cuts other tenants out of an impact graph, and refuses one rooted in theirs", async () => {
    assert.equal((await get("/api/objects/UserRequest/200/related", ann)).statusCode, 404);
    const res = await get("/api/objects/UserRequest/100/related", ann);
    assert.equal(res.statusCode, 200);
    const keys = res.json().nodes.map((n: { key: string }) => n.key).sort();
    assert.deepEqual(keys, ["UserRequest::100", "UserRequest::101"]);
    assert.deepEqual(res.json().edges, [{ from: "UserRequest::100", to: "UserRequest::101" }]);
  });

  it("scopes saved queries to the tenant's owners", async () => {
    await get("/api/queries", ann);
    const call = fake.calls.filter((c) => c.params["class"] === "QueryOQL").at(-1)!;
    assert.match(String(call.params["key"]), /owner_id IN \(SELECT Contact AS ts_1 WHERE ts_1.org_id IN \(10,11\)\)/);
  });

  it("keeps notification rules (whole-platform configuration) from tenants", async () => {
    const res = await get("/api/admin/notifications/rules", ann);
    assert.equal(res.statusCode, 403);
  });

  it("refuses a session on another tenant's domain", async () => {
    const res = await get("/api/objects/UserRequest", ann, "globex.test");
    assert.equal(res.statusCode, 403);
  });

  it("lets a platform operator see everything on the platform's own address", async () => {
    const res = await get("/api/objects/UserRequest", root);
    assert.deepEqual(res.json().items.map((i: { id: number }) => i.id).sort(), [100, 101, 200]);
    const onB = await get("/api/objects/UserRequest", root, "globex.test");
    assert.deepEqual(onB.json().items.map((i: { id: number }) => i.id), [200]);
  });

  it("only gives an account organisations of its own tenant", async () => {
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: ann, host: "app.example" }, payload });
    const res = await post({
      type: "local",
      login: "newbie",
      password: "long-enough-1",
      contact: { id: 101 },
      profileIds: [5],
      allowedOrgIds: [10, 20],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error.message, /own customer/);
  });
});

describe("guard on the client", () => {
  it("passes calls through untouched with no tenant bound", async () => {
    const fake = new MiniItop();
    const client = new TenantScopedClient(fake.asClient(), schema);
    await client.call("core/get", { class: "UserRequest", key: 200 });
    assert.equal(fake.lastCall().params["key"], 200);
  });

  it("refuses an import run as an Administrator or the service account", async () => {
    const fake = new MiniItop();
    const client = new TenantScopedClient(fake.asClient(), schema);
    await assert.rejects(
      runAs(staff("ann", 10), () => client.postScript("webservices/import.php", { class: "Person", csvdata: "" }), A),
      /not Administrators/,
    );
    const agent = staff("ann", 10, { isAdmin: false, allowedOrgIds: [10] });
    await runAs(agent, () => client.postScript("webservices/import.php", { class: "Person", csvdata: "" }), A);
    assert.equal(fake.scripts.length, 1);
    const wide = staff("ann", 10, { isAdmin: false, allowedOrgIds: [10, 20] });
    await assert.rejects(runAs(wide, () => client.postScript("webservices/import.php", { class: "Person", csvdata: "" }), A));
  });

  it("checks the organisations in a link set written with an account", async () => {
    const fake = new MiniItop();
    const client = new TenantScopedClient(fake.asClient(), schema);
    await assert.rejects(
      runAs(staff("ann", 10), () =>
        client.call("core/create", {
          class: "UserLocal",
          fields: { login: "x", contactid: 101, allowed_org_list: [{ allowed_org_id: 20 }] },
        }), A),
      /allowed_org_id/,
    );
  });
});
