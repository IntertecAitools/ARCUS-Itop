import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import type { SignInPolicy } from "../src/config/env.js";
import { MemoryMfaStore } from "../src/platform/auth/mfa.store.js";
import { MemorySignInAudit } from "../src/platform/auth/sign-in-audit.js";
import { MemoryTenantStore, type Tenant } from "../src/platform/tenancy/tenant.store.js";
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  newRecoveryCodes,
  otpauthUrl,
  timeStep,
  totpAt,
  verifyTotp,
} from "../src/platform/auth/totp.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 appendix B, SHA-1: the 8-digit codes' last six digits.
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC's test vectors", () => {
    assert.equal(rfcSecret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.equal(totpAt(rfcSecret, timeStep(59_000)), "287082");
    assert.equal(totpAt(rfcSecret, timeStep(1_111_111_109_000)), "081804");
    assert.equal(totpAt(rfcSecret, timeStep(1_234_567_890_000)), "005924");
    assert.equal(totpAt(rfcSecret, timeStep(2_000_000_000_000)), "279037");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
    assert.deepEqual(base32Decode("gezd gnbv-gy3t"), base32Decode("GEZDGNBVGY3T"));
  });

  it("accepts one step of clock drift either way, and no more", () => {
    const at = 1_111_111_109_000;
    const step = timeStep(at);
    assert.equal(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), at), step - 1);
    assert.equal(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 1), at), step + 1);
    assert.equal(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 2), at), undefined);
    assert.equal(verifyTotp(rfcSecret, "12345", at), undefined);
    assert.equal(verifyTotp(rfcSecret, "abcdef", at), undefined);
  });

  it("refuses a code at or before the last step used", () => {
    const at = 1_111_111_109_000;
    const step = timeStep(at);
    assert.equal(verifyTotp(rfcSecret, totpAt(rfcSecret, step), at, step), undefined);
  });

  it("builds an otpauth link authenticator apps read", () => {
    const url = new URL(otpauthUrl("ABC", "Arcus Helpdesk", "jane@x.io"));
    assert.equal(url.protocol, "otpauth:");
    assert.equal(url.host, "totp");
    assert.equal(decodeURIComponent(url.pathname), "/Arcus Helpdesk:jane@x.io");
    assert.equal(url.searchParams.get("secret"), "ABC");
    assert.equal(url.searchParams.get("issuer"), "Arcus Helpdesk");
  });

  it("makes ten distinct recovery codes, hashed case- and dash-blind", () => {
    const codes = newRecoveryCodes();
    assert.equal(new Set(codes).size, 10);
    assert.match(codes[0]!, /^[a-z2-7]{5}-[a-z2-7]{5}$/);
    assert.equal(hashRecoveryCode(codes[0]!), hashRecoveryCode(codes[0]!.toUpperCase().replace("-", "")));
  });
});

// --- sign-in with MFA, through the app ----------------------------------------

interface Account {
  id: number;
  login: string;
  password: string;
  profiles: string[];
  status?: string;
}

function itop(accounts: Account[]): FakeItopClient {
  const fake = new FakeItopClient()
    .on("list_operations", { code: 0, message: "Operations: 7", operations: [] })
    .on("core/get", (params) => {
      const key = String(params["key"]);
      const cls = String(params["class"]);
      if (cls === "User") {
        const login = /login = '([^']+)'/.exec(key)?.[1];
        const a = accounts.find((x) => x.login === login);
        return getResponse(
          a
            ? [{ class: "UserLocal", id: a.id, fields: { login: a.login, status: a.status ?? "enabled", contactid: "0", first_name: a.login, last_name: "", email: `${a.login}@x.io`, org_id: "1" } }]
            : [],
        );
      }
      if (cls === "URP_UserProfile") {
        const a = accounts.find((x) => key.endsWith(`= ${x.id}`));
        return getResponse((a?.profiles ?? []).map((profile, i) => ({ class: "URP_UserProfile", id: i + 1, fields: { profile } })));
      }
      if (cls === "URP_UserOrg") return getResponse([]);
      return getResponse([{ class: "Server", id: 1, fields: { name: "web-01" } }]);
    });
  for (const a of accounts) fake.passwords.set(a.login, a.password);
  return fake;
}

const AGENT: Account = { id: 12, login: "jane", password: "jane-pass-1", profiles: ["Service Desk Agent", "REST Services User"] };
const ADMIN: Account = { id: 1, login: "admin", password: "admin-pass-1", profiles: ["Administrator", "REST Services User"] };
const PORTAL: Account = { id: 30, login: "pat", password: "pat-pass-12", profiles: ["Portal user"] };
const BREAK_GLASS: Account = { id: 99, login: "breakglass", password: "glass-pass-1", profiles: ["Administrator", "REST Services User"] };

function setup(policy: Partial<SignInPolicy> = {}, accounts = [AGENT, ADMIN, PORTAL, BREAK_GLASS], tenants?: Tenant[]) {
  const fake = itop(accounts);
  const schema = sampleSchema();
  const audit = new MemorySignInAudit();
  const store = new MemoryMfaStore();
  const config = testConfig({
      auth: {
        required: true,
        sessionIdleMs: 3_600_000,
        sessionMaxMs: 3_600_000,
        cookieSecure: false,
        sessionStore: { kind: "memory" },
        signIn: {
          mfaRequired: "staff",
          totpIssuer: "Arcus Helpdesk",
          passwordSignIn: "all",
          breakGlassLogins: ["breakglass"],
          ...policy,
        },
      },
  });
  if (tenants) config.tenancy = { enabled: true, platformLogins: [] };
  const { app, services } = buildApp(config, {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
    mfaStore: store,
    signInAudit: audit,
    ...(tenants ? { tenants: new MemoryTenantStore(tenants) } : {}),
  });
  after(async () => {
    await app.close();
  });
  return { app, fake, audit, store, services };
}

type App = ReturnType<typeof setup>["app"];

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String([res.headers["set-cookie"]].flat()[0] ?? "").split(";")[0] ?? "";

async function login(app: App, account: Account) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: account.login, password: account.password } });
  return { res, cookie: cookieOf(res) };
}

/** Enrols through the sign-in flow; returns the secret, recovery codes and the full session cookie. */
async function enrol(app: App, account: Account) {
  const { res, cookie } = await login(app, account);
  assert.deepEqual(res.json(), { mfa: { step: "enrol" } });
  const setupRes = await app.inject({ method: "GET", url: "/api/auth/mfa/enrol", headers: { cookie } });
  const { secret } = setupRes.json() as { secret: string };
  const step = timeStep(Date.now());
  const done = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enrol",
    headers: { cookie },
    payload: { code: totpAt(secret, step) },
  });
  assert.equal(done.statusCode, 200, done.body);
  return { secret, step, recoveryCodes: done.json().recoveryCodes as string[], cookie: cookieOf(done), pendingCookie: cookie };
}

describe("MFA at password sign-in", () => {
  it("makes an agent enrol: a pending sign-in reaches nothing but the MFA step", async () => {
    const { app } = setup();
    const { res, cookie } = await login(app, AGENT);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { mfa: { step: "enrol" } });
    assert.match(String(res.headers["set-cookie"]), /Max-Age=600/);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    assert.equal(me.statusCode, 401);
    assert.deepEqual(me.json().error.details, { mfa: { step: "enrol" } });
    const api = await app.inject({ method: "GET", url: "/api/objects/Server", headers: { cookie } });
    assert.equal(api.statusCode, 401);
    const verify = await app.inject({ method: "POST", url: "/api/auth/mfa/verify", headers: { cookie }, payload: { code: "123456" } });
    assert.equal(verify.statusCode, 409, "an account with nothing enrolled cannot verify");

    const first = await app.inject({ method: "GET", url: "/api/auth/mfa/enrol", headers: { cookie } });
    const again = await app.inject({ method: "GET", url: "/api/auth/mfa/enrol", headers: { cookie } });
    const body = first.json();
    assert.match(body.secret, /^[A-Z2-7]{32}$/);
    assert.equal(again.json().secret, body.secret, "a reload shows the same secret");
    assert.match(body.otpauthUrl, /^otpauth:\/\/totp\//);
  });

  it("enrols with a code, answers recovery codes once, and starts a new session", async () => {
    const { app, fake, audit } = setup();
    const { recoveryCodes, cookie, pendingCookie } = await enrol(app, AGENT);
    assert.equal(recoveryCodes.length, 10);
    assert.notEqual(cookie, pendingCookie);

    const api = await app.inject({ method: "GET", url: "/api/objects/Server", headers: { cookie } });
    assert.equal(api.statusCode, 200);
    assert.equal(fake.lastCall().as, "jane");
    const old = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: pendingCookie } });
    assert.equal(old.statusCode, 401, "the pending cookie is no session");

    const status = await app.inject({ method: "GET", url: "/api/auth/mfa", headers: { cookie } });
    assert.equal(status.json().enrolled, true);
    assert.equal(status.json().recoveryCodesLeft, 10);
    assert.equal(status.json().secondFactor, "totp");

    const events = (await audit.list({ limit: 10 })).map((e) => e.event);
    assert.deepEqual(events, ["sign_in", "mfa_enrolled"]);
  });

  it("asks an enrolled agent for a code; a code works once; a recovery code works once", async () => {
    const { app } = setup();
    const { secret, step, recoveryCodes } = await enrol(app, AGENT);

    // The enrolment used this step's code already.
    let pending = (await login(app, AGENT)).cookie;
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie: pending },
      payload: { code: totpAt(secret, step) },
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().error.details.attemptsLeft, 4);

    const recovered = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie: pending },
      payload: { recoveryCode: recoveryCodes[0]!.toUpperCase() },
    });
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().user.login, "jane");

    pending = (await login(app, AGENT)).cookie;
    const reused = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie: pending },
      payload: { recoveryCode: recoveryCodes[0] },
    });
    assert.equal(reused.statusCode, 401, "a recovery code works once");
    const next = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie: pending },
      payload: { code: totpAt(secret, timeStep(Date.now()) + 1) },
    });
    assert.equal(next.statusCode, 200, "the next step's code is fine (drift)");
  });

  it("starts the sign-in over after five wrong codes", async () => {
    const { app } = setup();
    const { secret } = await enrol(app, AGENT);
    const { cookie } = await login(app, AGENT);
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await app.inject({ method: "POST", url: "/api/auth/mfa/verify", headers: { cookie }, payload: { code: "000000" } });
    }
    assert.match(last!.json().error.message, /Too many wrong codes/);
    const late = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie },
      payload: { code: totpAt(secret, timeStep(Date.now()) + 1) },
    });
    assert.equal(late.statusCode, 401, "the right code no longer helps that sign-in");
    assert.match(late.json().error.message, /expired/);
  });

  it("asks nothing of end users, nor of staff when MFA_REQUIRED=off and they have not enrolled", async () => {
    const { app } = setup({ mfaRequired: "off" });
    assert.equal((await login(app, PORTAL)).res.json().user.kind, "portal");
    assert.equal((await login(app, AGENT)).res.json().user.login, "jane");
  });

  it("MFA_REQUIRED=admin asks administrators only", async () => {
    const { app } = setup({ mfaRequired: "admin" });
    assert.ok((await login(app, AGENT)).res.json().user);
    assert.deepEqual((await login(app, ADMIN)).res.json(), { mfa: { step: "enrol" } });
  });

  it("an enrolled account is asked even when the policy would not ask it", async () => {
    const { app, store } = setup({ mfaRequired: "off" });
    await store.put({ userId: AGENT.id, login: "jane", secret: "GEZDGNBVGY3TQOJQ", enrolledAt: 1 }, []);
    assert.deepEqual((await login(app, AGENT)).res.json(), { mfa: { step: "verify" } });
  });

  it("lets a signed-in user renew their recovery codes with a current code", async () => {
    const { app } = setup();
    const { secret, cookie } = await enrol(app, AGENT);
    const wrong = await app.inject({ method: "POST", url: "/api/auth/mfa/recovery-codes", headers: { cookie }, payload: { code: "000000" } });
    assert.equal(wrong.statusCode, 400);
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/recovery-codes",
      headers: { cookie },
      payload: { code: totpAt(secret, timeStep(Date.now()) + 1) },
    });
    assert.equal(ok.json().recoveryCodes.length, 10);
  });

  it("lets an administrator remove someone's authenticator, which signs them out", async () => {
    const { app, audit } = setup();
    const jane = await enrol(app, AGENT);
    const adminSession = await enrol(app, ADMIN);

    const reset = await app.inject({ method: "DELETE", url: `/api/admin/users/${AGENT.id}/mfa`, headers: { cookie: adminSession.cookie } });
    assert.equal(reset.statusCode, 204);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: jane.cookie } });
    assert.equal(me.statusCode, 401);
    const missing = await app.inject({ method: "DELETE", url: `/api/admin/users/${AGENT.id}/mfa`, headers: { cookie: adminSession.cookie } });
    assert.equal(missing.statusCode, 404);
    // Enrols afresh at the next sign-in.
    assert.deepEqual((await login(app, AGENT)).res.json(), { mfa: { step: "enrol" } });

    const log = await app.inject({ method: "GET", url: "/api/admin/sign-in-audit?limit=50", headers: { cookie: adminSession.cookie } });
    const resetEntry = log.json().entries.find((e: { event: string }) => e.event === "mfa_reset");
    assert.equal(resetEntry.userId, AGENT.id);
    assert.match(resetEntry.detail, /removed by admin/);
    assert.ok((await audit.list({ limit: 50 })).length > 3);

    const asAgent = await app.inject({ method: "DELETE", url: `/api/admin/users/${ADMIN.id}/mfa`, headers: { cookie: jane.cookie } });
    assert.equal(asAgent.statusCode, 401, "jane was signed out");
  });
});

describe("password sign-in policy and break-glass", () => {
  it("PASSWORD_SIGN_IN=portal sends staff to single sign-on but lets end users and break-glass in", async () => {
    const { app } = setup({ passwordSignIn: "portal", mfaRequired: "off" });
    const agent = await login(app, AGENT);
    assert.equal(agent.res.statusCode, 403);
    assert.match(agent.res.json().error.message, /single sign-on/);
    assert.equal((await login(app, PORTAL)).res.statusCode, 200);
    assert.deepEqual((await login(app, BREAK_GLASS)).res.json(), { mfa: { step: "enrol" } });
  });

  it("PASSWORD_SIGN_IN=break-glass refuses everyone else's password", async () => {
    const { app } = setup({ passwordSignIn: "break-glass" });
    assert.equal((await login(app, PORTAL)).res.statusCode, 403);
    assert.equal((await login(app, ADMIN)).res.statusCode, 403);
  });

  it("break-glass always needs a code, even with MFA off, and every use is audited", async () => {
    const { app, audit } = setup({ mfaRequired: "off" });
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "breakglass", password: "nope" } });
    assert.equal(wrong.statusCode, 401);

    const { cookie } = await enrol(app, BREAK_GLASS);
    await app.inject({ method: "GET", url: "/api/objects/Server", headers: { cookie } });
    await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });

    const entries = await audit.list({ limit: 20, login: "breakglass" });
    const events = entries.map((e) => e.event).reverse();
    assert.deepEqual(events, [
      "break_glass_refused",
      "mfa_enrolled",
      "break_glass_sign_in",
      "break_glass_request",
      "break_glass_request",
    ]);
    assert.ok(entries.every((e) => e.method === "break-glass"));
    assert.equal(entries[1]!.detail, "GET /api/objects/Server -> 200");
    assert.match(entries[4]!.detail ?? "", /Wrong login or password/);
  });

  it("records refused password sign-ins, without the password", async () => {
    const { app, audit } = setup();
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "jane", password: "guess-123" } });
    const [entry] = await audit.list({ limit: 1 });
    assert.equal(entry?.event, "sign_in_refused");
    assert.equal(entry?.login, "jane");
    assert.ok(!JSON.stringify(entry).includes("guess-123"));
  });

  it("limits wrong codes per login, even across sign-ins with the right password", async () => {
    const { app } = setup();
    const { secret } = await enrol(app, AGENT);
    // Ten wrong codes, two per sign-in, from addresses that change each time.
    for (let i = 0; i < 5; i += 1) {
      const { cookie } = await login(app, AGENT);
      for (let j = 0; j < 2; j += 1) {
        await app.inject({
          method: "POST",
          url: "/api/auth/mfa/verify",
          headers: { cookie },
          payload: { code: "000000" },
          remoteAddress: `10.0.${i}.${j}`,
        });
      }
    }
    const { cookie } = await login(app, AGENT);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      headers: { cookie },
      payload: { code: totpAt(secret, timeStep(Date.now()) + 1) },
      remoteAddress: "10.9.9.9",
    });
    assert.equal(blocked.statusCode, 429);
  });
});

describe("MFA with tenancy", () => {
  const TENANTS: Tenant[] = [
    { id: "acme", name: "Acme", status: "active", domains: ["acme.test"], orgIds: [1] },
    { id: "globex", name: "Globex", status: "active", domains: ["globex.test"], orgIds: [2] },
  ];
  const at = (host: string, cookie?: string) => ({ host, ...(cookie ? { cookie } : {}) });

  it("refuses another tenant's site before any MFA step, and binds the tenant once the code is given", async () => {
    const { app, fake } = setup({}, [AGENT], TENANTS);
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: at("globex.test"),
      payload: { login: AGENT.login, password: AGENT.password },
    });
    assert.equal(wrong.statusCode, 403);
    assert.match(wrong.json().error.message, /another site/);
    assert.equal(wrong.headers["set-cookie"], undefined, "no pending session for a refused tenant");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: at("acme.test"),
      payload: { login: AGENT.login, password: AGENT.password },
    });
    assert.deepEqual(res.json(), { mfa: { step: "enrol" } });
    const pending = cookieOf(res);
    const { secret } = (await app.inject({ method: "GET", url: "/api/auth/mfa/enrol", headers: at("acme.test", pending) })).json();
    const done = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/enrol",
      headers: at("acme.test", pending),
      payload: { code: totpAt(secret, timeStep(Date.now())) },
    });
    assert.equal(done.statusCode, 200, done.body);
    const cookie = cookieOf(done);

    const list = await app.inject({ method: "GET", url: "/api/objects/Server", headers: at("acme.test", cookie) });
    assert.equal(list.statusCode, 200);
    assert.equal(fake.lastCall().as, "jane");
    const elsewhere = await app.inject({ method: "GET", url: "/api/objects/Server", headers: at("globex.test", cookie) });
    assert.equal(elsewhere.statusCode, 403, "the session is still held to its own tenant");
  });
});
