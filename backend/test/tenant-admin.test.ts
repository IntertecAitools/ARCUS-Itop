import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import type { Caller } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import type { PasswordResetService } from "../src/platform/auth/password-reset.service.js";
import { MemoryPreferencesStore } from "../src/platform/auth/preferences.store.js";
import { MemorySessionStore } from "../src/platform/auth/session.store.js";
import { RegistrationService } from "../src/platform/portal/registration.service.js";
import { TenantResolver } from "../src/platform/tenancy/resolve.js";
import { MemoryTenantStore, tenantOfEmail, validateBranding, type Tenant } from "../src/platform/tenancy/tenant.store.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, testConfig } from "./helpers.js";

const SCHEMA_DIR = resolve(import.meta.dirname, "..", "..", "cmdb-schema");
const schema = CmdbSchema.fromFile(resolve(SCHEMA_DIR, "cmdb-schema.json"));

const PNG = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;

function tenants(): Tenant[] {
  return [
    { id: "acme", name: "Acme", status: "active", domains: ["acme.test"], orgIds: [10, 11] },
    { id: "globex", name: "Globex", status: "active", domains: ["globex.test"], orgIds: [20], emailDomains: [{ domain: "globex.com", orgId: 20 }] },
  ];
}

function staff(login: string, orgId: number, profiles = ["Administrator"]): Caller {
  return {
    userId: orgId * 10,
    login,
    contactId: orgId * 10 + 1,
    name: login,
    email: "",
    kind: "staff",
    profiles,
    isAdmin: profiles.includes("Administrator"),
    allowedOrgIds: [],
    orgId,
    credentials: { user: login, password: "pw" },
  };
}

const PROFILES = [
  { id: 1, name: "Administrator" },
  { id: 2, name: "Support Agent" },
  { id: 3, name: "Portal user" },
  { id: 4, name: "REST Services User" },
];

/** Answers by class; enough for the tenant administration's reads and writes. */
function fakeItop() {
  const fake = new FakeItopClient();
  fake.on("core/get", (p) => {
    switch (p["class"]) {
      case "URP_Profiles":
        return getResponse(PROFILES.filter((r) => !String(p["key"]).includes("name =") || String(p["key"]).includes(`'${r.name}'`)).map((r) => ({ class: "URP_Profiles", id: r.id, fields: { name: r.name, description: "" } })));
      case "Organization": {
        const only = /WHERE id = (\d+)/.exec(String(p["key"]))?.[1];
        return getResponse([
          { class: "Organization", id: 10, fields: { name: "Acme HQ", code: "ACME", status: "active", parent_id: 0, org_id: 10 } },
          { class: "Organization", id: 11, fields: { name: "Acme Labs", code: "", status: "active", parent_id: 10, org_id: 11 } },
        ].filter((o) => !only || o.id === Number(only)));
      }
      case "Team":
        return getResponse([{ class: "Team", id: 50, fields: { name: "Acme desk", email: "", status: "active", org_id: 10, org_name: "Acme HQ" } }]);
      case "lnkPersonToTeam":
        return getResponse([{ class: "lnkPersonToTeam", id: 1, fields: { team_id: 50, person_id: 101, person_name: "Ann" } }]);
      default:
        return getResponse([]);
    }
  });
  fake.on("core/create", (p) => getResponse([{ class: String(p["class"]), id: 999, fields: { id: "999" } }]));
  fake.on("core/update", (p) => getResponse([{ class: String(p["class"]), id: 1, fields: {} }]));
  return fake;
}

async function setup() {
  const fake = fakeItop();
  const store = new MemoryTenantStore(tenants());
  const sessions = new MemorySessionStore(3_600_000, 3_600_000);
  const config = testConfig({
    navigationPath: resolve(SCHEMA_DIR, "cmdb-navigation.json"),
    dashboardsPath: resolve(SCHEMA_DIR, "cmdb-dashboards.json"),
    auth: { required: true, sessionIdleMs: 3_600_000, sessionMaxMs: 3_600_000, cookieSecure: false, sessionStore: { kind: "memory" } },
  });
  const preferences = new MemoryPreferencesStore();
  const { app } = buildApp(
    { ...config, tenancy: { enabled: true, platformLogins: ["root"] } },
    { client: fake.asClient(), schema, sessions, tenants: store, preferences },
  );
  after(async () => {
    await app.close();
  });
  const cookieFor = async (caller: Caller) => `intertec_sid=${await sessions.create(caller)}`;
  const send = (method: "GET" | "PUT" | "POST" | "PATCH", url: string, cookie?: string, payload?: unknown, host = "app.example") =>
    app.inject({ method, url, headers: { host, ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return {
    fake,
    store,
    preferences,
    send,
    ann: await cookieFor(staff("ann", 10)),
    agent: await cookieFor(staff("agent", 11, ["Support Agent"])),
    root: await cookieFor(staff("root", 1)),
  };
}

describe("tenant store: email domains and branding", () => {
  it("keeps an email domain to one tenant, pointing at one of its organisations", async () => {
    const store = new MemoryTenantStore(tenants());
    await assert.rejects(store.save({ ...tenants()[0]!, emailDomains: [{ domain: "globex.com", orgId: 10 }] }), /another customer/);
    await assert.rejects(store.save({ ...tenants()[0]!, emailDomains: [{ domain: "acme.com", orgId: 20 }] }), /not one of Acme's/);
    await store.save({ ...tenants()[0]!, emailDomains: [{ domain: "ACME.com", orgId: 11 }] });
    assert.deepEqual(tenantOfEmail("Pat@Acme.COM", await store.list())?.orgId, 11);
    assert.equal(tenantOfEmail("pat@elsewhere.com", await store.list()), undefined);
  });

  it("keeps branding and email domains when a save leaves them out", async () => {
    const store = new MemoryTenantStore(tenants());
    await store.save({ ...tenants()[0]!, branding: { productName: "Acme Desk" }, emailDomains: [{ domain: "acme.com", orgId: 10 }] });
    await store.save({ ...tenants()[0]!, name: "Acme Corp" });
    const acme = (await store.list()).find((t) => t.id === "acme")!;
    assert.equal(acme.branding?.productName, "Acme Desk");
    assert.deepEqual(acme.emailDomains, [{ domain: "acme.com", orgId: 10 }]);
    // An organisation taken away takes its email domains with it.
    await store.save({ ...acme, orgIds: [11], emailDomains: undefined });
    assert.deepEqual((await store.list()).find((t) => t.id === "acme")!.emailDomains, []);
  });

  it("checks colours and logos", () => {
    assert.deepEqual(validateBranding({ accentColor: "#0EA5E9", productName: "  Desk " }), { accentColor: "#0ea5e9", productName: "Desk" });
    assert.throws(() => validateBranding({ accentColor: "red" }), /hex colour/);
    assert.throws(() => validateBranding({ logo: "data:text/html;base64,PHNjcmlwdD4=" }), /PNG, JPEG, WebP or SVG/);
    assert.throws(() => validateBranding({ logo: `data:image/png;base64,${"A".repeat(300_000)}` }), /too large/);
  });
});

describe("tenant administration (routes)", async () => {
  const { send, store, ann, agent, root, fake } = await setup();

  it("shows a customer administrator their own tenant only", async () => {
    const list = await send("GET", "/api/admin/tenants", ann);
    assert.deepEqual(list.json(), { operator: false, tenants: [{ id: "acme", name: "Acme", status: "active" }] });
    assert.equal((await send("GET", "/api/admin/tenants/acme", ann)).statusCode, 200);
    assert.equal((await send("GET", "/api/admin/tenants/globex", ann)).statusCode, 404);
    assert.equal((await send("PUT", "/api/admin/tenants/globex/branding", ann, { productName: "pwned" })).statusCode, 404);
    assert.equal((await send("GET", "/api/admin/tenants/acme", agent)).statusCode, 403);
  });

  it("lets the platform operator manage any tenant, and host names", async () => {
    const list = await send("GET", "/api/admin/tenants", root);
    assert.equal(list.json().operator, true);
    assert.equal(list.json().tenants.length, 2);
    assert.equal((await send("PUT", "/api/admin/tenants/acme/hostnames", ann, { hostnames: ["evil.test"] })).statusCode, 403);
    const res = await send("PUT", "/api/admin/tenants/acme/hostnames", root, { hostnames: ["acme.test", "Desk.Acme.Test"] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().hostnames, ["acme.test", "desk.acme.test"]);
  });

  it("saves branding and serves it by host name, the logo with a no-script CSP", async () => {
    const bad = await send("PUT", "/api/admin/tenants/acme/branding", ann, { accentColor: "violet" });
    assert.equal(bad.statusCode, 400);
    const res = await send("PUT", "/api/admin/tenants/acme/branding", ann, { productName: "Acme Desk", accentColor: "#0ea5e9", logo: PNG });
    assert.equal(res.statusCode, 200);
    assert.match(res.json().branding.logoUrl, /^\/branding\/logo\/acme\?v=[0-9a-f]{10}$/);

    const pub = await send("GET", "/api/branding", undefined, undefined, "acme.test");
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.json().branding.productName, "Acme Desk");
    assert.equal(pub.json().branding.accentColor, "#0ea5e9");
    assert.deepEqual((await send("GET", "/api/branding", undefined, undefined, "app.example")).json(), { branding: null });
    // Signed in on the platform address: the user's own tenant.
    assert.equal((await send("GET", "/api/branding", ann)).json().branding.tenantId, "acme");

    const logo = await send("GET", "/api/branding/logo/acme");
    assert.equal(logo.statusCode, 200);
    assert.equal(logo.headers["content-type"], "image/png");
    assert.match(String(logo.headers["content-security-policy"]), /default-src 'none'.*sandbox/);
    assert.equal((await send("GET", "/api/branding/logo/globex")).statusCode, 404);
  });

  it("maps email domains to the tenant's organisations, never public mail providers", async () => {
    assert.equal((await send("PUT", "/api/admin/tenants/acme/email-domains", ann, { emailDomains: [{ domain: "gmail.com", orgId: 10 }] })).statusCode, 400);
    assert.equal((await send("PUT", "/api/admin/tenants/acme/email-domains", ann, { emailDomains: [{ domain: "acme.com", orgId: 20 }] })).statusCode, 400);
    assert.equal((await send("PUT", "/api/admin/tenants/acme/email-domains", ann, { emailDomains: [{ domain: "globex.com", orgId: 10 }] })).statusCode, 400);
    const ok = await send("PUT", "/api/admin/tenants/acme/email-domains", ann, { emailDomains: [{ domain: "@Acme.com", orgId: 11 }] });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json().emailDomains, [{ domain: "acme.com", orgId: 11 }]);
  });

  it("adds an organisation to the tenant, with a parent of its own only", async () => {
    assert.equal((await send("POST", "/api/admin/tenants/acme/orgs", ann, { name: "Branch", parentId: 20 })).statusCode, 400);
    const res = await send("POST", "/api/admin/tenants/acme/orgs", ann, { name: "Branch", parentId: 10 });
    assert.equal(res.statusCode, 201);
    assert.ok((await store.list()).find((t) => t.id === "acme")!.orgIds.includes(999));
    const create = fake.calls.find((c) => c.verb === "core/create" && c.params["class"] === "Organization")!;
    assert.deepEqual(create.params["fields"], { name: "Branch", parent_id: 10 });
    assert.equal((await send("PATCH", "/api/admin/tenants/acme/orgs/20", ann, { name: "x" })).statusCode, 404);
  });

  it("manages teams inside the tenant", async () => {
    const list = await send("GET", "/api/admin/tenants/acme/teams", ann);
    assert.deepEqual(list.json().items[0].members, [{ id: 101, name: "Ann" }]);
    assert.equal((await send("POST", "/api/admin/tenants/acme/teams", ann, { name: "Desk", orgId: 20 })).statusCode, 400);
    const created = await send("POST", "/api/admin/tenants/acme/teams", ann, { name: "Desk", orgId: 10 });
    assert.equal(created.statusCode, 201, created.body);
  });

  it("limits what a customer administrator may grant", async () => {
    const profiles = (await send("GET", "/api/admin/profiles", ann)).json().profiles as { name: string; grantable: boolean }[];
    assert.equal(profiles.find((p) => p.name === "Administrator")?.grantable, false);
    assert.equal(profiles.find((p) => p.name === "Support Agent")?.grantable, true);
    const asRoot = (await send("GET", "/api/admin/profiles", root)).json().profiles as { name: string; grantable: boolean }[];
    assert.ok(asRoot.every((p) => p.grantable));

    const res = await send("POST", "/api/admin/users", ann, { type: "local", login: "newadmin", password: "longenough1", contact: { id: 101 }, profileIds: [1] });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /platform operator/);
  });

  it("keeps each user's interface language", async () => {
    assert.equal((await send("PUT", "/api/auth/language", ann, { language: "fr" })).statusCode, 400);
    assert.equal((await send("PUT", "/api/auth/language", ann, { language: "ar" })).statusCode, 200);
    assert.equal((await send("GET", "/api/auth/me", ann)).json().user.language, "ar");
    // English is mirrored to iTop's own field; Arabic is not (iTop has no Arabic dictionary).
    assert.equal(fake.calls.filter((c) => c.verb === "core/update" && c.params["class"] === "User").length, 0);
    await send("PUT", "/api/auth/language", ann, { language: "en" });
    const mirror = fake.calls.find((c) => c.verb === "core/update" && c.params["class"] === "User")!;
    assert.deepEqual(mirror.params["fields"], { language: "EN US" });
  });
});

describe("self-registration by email domain", () => {
  function build(on = true) {
    const fake = fakeItop();
    const store = new MemoryTenantStore(tenants());
    const resolver = new TenantResolver(store, { enabled: true, platformLogins: [] });
    const sent: string[] = [];
    const reset = {
      enabled: true,
      request: (email: string) => async () => {
        sent.push(email);
      },
    } as unknown as PasswordResetService;
    return { fake, sent, service: new RegistrationService(fake.asClient(), resolver, reset, on) };
  }

  it("creates a portal account in the domain's organisation, then mails the set-password link", async () => {
    const { fake, sent, service } = build();
    const work = await service.register({ firstName: "Pat", lastName: "Lee", email: "Pat@Globex.com" }, "1.2.3.4");
    await work();
    const creates = fake.calls.filter((c) => c.verb === "core/create");
    assert.deepEqual(creates.map((c) => c.params["class"]), ["Person", "UserLocal"]);
    assert.equal((creates[0]!.params["fields"] as Record<string, unknown>)["org_id"], 20);
    const account = creates[1]!.params["fields"] as Record<string, unknown>;
    assert.equal(account["login"], "pat@globex.com");
    assert.deepEqual(account["profile_list"], [{ profileid: 3 }]);
    assert.deepEqual(account["allowed_org_list"], [{ allowed_org_id: 20 }]);
    assert.deepEqual(sent, ["pat@globex.com"]);
  });

  it("refuses an unclaimed domain and does nothing when it is off", async () => {
    const { service } = build();
    await assert.rejects(service.register({ firstName: "", lastName: "X", email: "x@nobody.org" }, "1.2.3.4"), /No organisation/);
    const off = build(false).service;
    await assert.rejects(off.register({ firstName: "", lastName: "X", email: "x@globex.com" }, "1.2.3.4"), /not available/);
    assert.equal(await off.provision("x@globex.com"), false);
  });

  it("gives an existing address only the link, creating nothing", async () => {
    const { fake, sent, service } = build();
    fake.on("core/get", (p) =>
      p["class"] === "User" ? getResponse([{ class: "UserLocal", id: 7, fields: {} }]) : ({ code: 0, message: "Found: 0", objects: {} } as ItopResult),
    );
    await (await service.register({ firstName: "", lastName: "Lee", email: "pat@globex.com" }, "1.2.3.5"))();
    assert.equal(fake.calls.filter((c) => c.verb === "core/create").length, 0);
    assert.deepEqual(sent, ["pat@globex.com"]);
  });
});
