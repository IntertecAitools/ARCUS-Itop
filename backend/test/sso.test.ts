import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { describe, it } from "node:test";

import type { SsoConfig } from "../src/config/env.js";
import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import { ItopClient } from "../src/itop/client.js";
import { AuthService } from "../src/platform/auth/auth.service.js";
import { Sealer } from "../src/platform/auth/seal.js";
import { safeReturnTo, SsoService, type SsoIdentity } from "../src/platform/auth/sso.service.js";
import { FakeItopClient, getResponse, testConfig } from "./helpers.js";

const SSO: SsoConfig = {
  issuer: "https://login.example.test/tenant/v2.0",
  clientId: "arcus",
  redirectUri: "https://helpdesk.example.test/api/auth/sso/callback",
  scopes: "openid profile email",
  emailClaims: ["email", "preferred_username", "upn"],
  label: "Sign in with Microsoft",
  mfa: "idp-or-totp",
  mfaAmr: ["mfa", "otp", "hwk"],
  appUrl: "https://helpdesk.example.test",
  allowHttp: false,
};

const sso = (now = () => Date.now()) => new SsoService(SSO, new Sealer("x".repeat(40), "sso-state"), now);

describe("single sign-on: reading the ID token", () => {
  it("takes the first claim that holds an email address", () => {
    assert.equal(sso().identity({ sub: "1", preferred_username: "jane@x.io", upn: "other@x.io" }).email, "jane@x.io");
    assert.equal(sso().identity({ sub: "1", email: "not-an-email", upn: "jane@x.io" }).email, "jane@x.io");
  });

  it("skips an email the IdP marks unverified", () => {
    const id = sso().identity({ sub: "1", email: "fake@x.io", email_verified: false, preferred_username: "jane@x.io" });
    assert.equal(id.email, "jane@x.io");
  });

  it("refuses an identity with no email address", () => {
    assert.throws(() => sso().identity({ sub: "1", name: "Jane" }), (e: AppError) => e.code === "forbidden");
  });

  it("reads MFA from amr (RFC 8176), case-blind", () => {
    assert.equal(sso().identity({ sub: "1", email: "a@x.io", amr: ["pwd", "MFA"] }).mfa, true);
    assert.equal(sso().identity({ sub: "1", email: "a@x.io", amr: ["pwd"] }).mfa, false);
    assert.equal(sso().identity({ sub: "1", email: "a@x.io" }).mfa, false);
  });

  it("only returns to paths on our own site", () => {
    assert.equal(safeReturnTo("/tickets/5?tab=log"), "/tickets/5?tab=log");
    assert.equal(safeReturnTo("https://evil.test/"), "/");
    assert.equal(safeReturnTo("//evil.test/"), "/");
    assert.equal(safeReturnTo("/\\evil.test"), "/");
    assert.equal(safeReturnTo(undefined), "/");
  });

  it("lands on the frontend, or on its sign-in page with the reason", () => {
    assert.equal(sso().landing("/tickets"), "https://helpdesk.example.test/tickets");
    assert.equal(sso().landing("/", "No account"), "https://helpdesk.example.test/login?sso_error=No%20account");
  });

  it("refuses a callback without its state cookie, or with a forged or stale one", async () => {
    const service = sso();
    await assert.rejects(service.finish("code=abc&state=s", undefined), /took too long/);
    await assert.rejects(service.finish("code=abc&state=s", "Zm9yZ2Vk"), /took too long/);

    // Sealed under another key: as good as forged.
    const other = new Sealer("y".repeat(40), "sso-state");
    const foreign = other.seal(JSON.stringify({ state: "s", nonce: "n", verifier: "v", returnTo: "/", expiresAt: Date.now() + 60_000 }), "sso-state");
    await assert.rejects(service.finish("code=abc&state=s", foreign.toString("base64url")), /took too long/);

    const sealer = new Sealer("x".repeat(40), "sso-state");
    const stale = sealer.seal(JSON.stringify({ state: "s", nonce: "n", verifier: "v", returnTo: "/", expiresAt: Date.now() - 1 }), "sso-state");
    await assert.rejects(service.finish("code=abc&state=s", stale.toString("base64url")), /took too long/);
  });
});

describe("single sign-on: finding the account", () => {
  const identity: SsoIdentity = { email: "jane@x.io", subject: "abc", amr: [], mfa: false };

  function itop(users: { class: string; id: number; login: string; status?: string }[], profiles: string[], personStatus = "active") {
    return new FakeItopClient()
      .on("list_operations", { code: 0, message: "Operations: 7", operations: [] })
      .on("core/get", (params) => {
        const key = String(params["key"]);
        if (params["class"] === "User" && key.includes("email =")) {
          return getResponse(users.map((u) => ({ class: u.class, id: u.id, fields: { login: u.login, status: u.status ?? "enabled" } })));
        }
        if (params["class"] === "User") {
          const u = users.find((x) => key.includes(`'${x.login}'`))!;
          return getResponse([
            { class: u.class, id: u.id, fields: { login: u.login, status: u.status ?? "enabled", contactid: "7", first_name: "Jane", last_name: "Doe", email: "jane@x.io", org_id: "3" } },
          ]);
        }
        if (params["class"] === "URP_UserProfile") {
          return getResponse(profiles.map((profile, i) => ({ class: "URP_UserProfile", id: i + 1, fields: { profile } })));
        }
        if (params["class"] === "Person") return getResponse([{ class: "Person", id: 7, fields: { status: personStatus } }]);
        return getResponse([]);
      });
  }

  const auth = (fake: FakeItopClient, externalItopAuth = true) => new AuthService(fake.asClient(), Date.now, { externalItopAuth });
  const refused = (pattern: RegExp) => (e: unknown) => e instanceof AppError && e.code === "forbidden" && pattern.test(e.message);

  it("signs in the one UserExternal staff account with that email, calling iTop as them", async () => {
    const fake = itop([{ class: "UserExternal", id: 12, login: "jane@x.io" }], ["Service Desk Agent", "REST Services User"]);
    const caller = await auth(fake).signInWithSso(identity);
    assert.equal(caller.login, "jane@x.io");
    assert.equal(caller.kind, "staff");
    assert.deepEqual(caller.credentials, { user: "jane@x.io", external: true });
    assert.deepEqual(caller.signIn, { method: "sso" });
    // The REST-access check ran as jane, through the external login.
    assert.equal(fake.calls.find((c) => c.verb === "list_operations")?.as, "jane@x.io");
  });

  it("signs an end user in with any kind of account", async () => {
    const fake = itop([{ class: "UserLocal", id: 30, login: "pat" }], ["Portal user"]);
    const caller = await auth(fake, false).signInWithSso(identity);
    assert.equal(caller.kind, "portal");
    assert.equal(caller.credentials, undefined);
  });

  it("refuses an unknown email", async () => {
    await assert.rejects(auth(itop([], [])).signInWithSso(identity), refused(/No helpdesk account belongs to jane@x.io/));
  });

  it("refuses a disabled account, and an inactive person", async () => {
    const disabled = itop([{ class: "UserExternal", id: 12, login: "jane@x.io", status: "disabled" }], ["Service Desk Agent"]);
    await assert.rejects(auth(disabled).signInWithSso(identity), refused(/disabled/));
    const gone = itop([{ class: "UserExternal", id: 12, login: "jane@x.io" }], ["Service Desk Agent"], "inactive");
    await assert.rejects(auth(gone).signInWithSso(identity), refused(/inactive/));
  });

  it("refuses an email shared by several enabled accounts, ignoring disabled ones", async () => {
    const two = itop(
      [
        { class: "UserExternal", id: 12, login: "jane@x.io" },
        { class: "UserLocal", id: 13, login: "jane" },
      ],
      ["Service Desk Agent"],
    );
    await assert.rejects(auth(two).signInWithSso(identity), refused(/Several helpdesk accounts/));
    const oneLeft = itop(
      [
        { class: "UserExternal", id: 12, login: "jane@x.io" },
        { class: "UserLocal", id: 13, login: "jane", status: "disabled" },
      ],
      ["Service Desk Agent", "REST Services User"],
    );
    assert.equal((await auth(oneLeft).signInWithSso(identity)).userId, 12);
  });

  it("refuses staff whose account is a password account, or when iTop is not set up for it", async () => {
    const local = itop([{ class: "UserLocal", id: 12, login: "jane" }], ["Service Desk Agent"]);
    await assert.rejects(auth(local).signInWithSso(identity), refused(/external account/));
    const external = itop([{ class: "UserExternal", id: 12, login: "jane@x.io" }], ["Service Desk Agent"]);
    await assert.rejects(auth(external, false).signInWithSso(identity), refused(/not set up/));
  });
});

describe("iTop calls for a single sign-on user", () => {
  async function capture(externalAuthHeader: string | undefined, run: (client: ItopClient) => Promise<unknown>) {
    const seen: { headers: IncomingHttpHeaders; body: string }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (c: Buffer) => chunks.push(c));
      request.on("end", () => {
        seen.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: 0, message: "ok", operations: [] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const config = testConfig({ auth: { required: true, sessionIdleMs: 1, sessionMaxMs: 1, cookieSecure: false, sessionStore: { kind: "memory" } } });
    config.itop = {
      ...config.itop,
      baseUrl: `http://127.0.0.1:${port}`,
      endpoint: `http://127.0.0.1:${port}/webservices/rest.php`,
      ...(externalAuthHeader ? { externalAuthHeader } : {}),
    };
    try {
      return { result: await run(new ItopClient(config)).catch((e: unknown) => e), seen };
    } finally {
      server.close();
    }
  }

  const jane: Caller = {
    userId: 12,
    login: "jane@x.io",
    contactId: 7,
    name: "Jane",
    email: "jane@x.io",
    kind: "staff",
    profiles: [],
    isAdmin: false,
    allowedOrgIds: [],
    orgId: 3,
    credentials: { user: "jane@x.io", external: true },
  };

  it("sends the login in the configured header and no password", async () => {
    const { seen } = await capture("X-Arcus-Remote-User", (client) => runAs(jane, () => client.call("list_operations", {})));
    assert.equal(seen[0]?.headers["x-arcus-remote-user"], "jane@x.io");
    const form = new URLSearchParams(seen[0]!.body);
    assert.equal(form.get("auth_user"), null);
    assert.equal(form.get("auth_pwd"), null);
  });

  it("still uses the service account's password when asked to", async () => {
    const { seen } = await capture("X-Arcus-Remote-User", (client) =>
      runAs(jane, () => client.call("list_operations", {}, { asService: true })),
    );
    assert.equal(seen[0]?.headers["x-arcus-remote-user"], undefined);
    assert.equal(new URLSearchParams(seen[0]!.body).get("auth_user"), "svc");
  });

  it("refuses to call at all when the header is not configured", async () => {
    const { result, seen } = await capture(undefined, (client) => runAs(jane, () => client.call("list_operations", {})));
    assert.ok(result instanceof AppError && result.code === "forbidden");
    assert.equal(seen.length, 0);
  });

  it("makes no call as a user still waiting for their authenticator code", async () => {
    const pending: Caller = { ...jane, signIn: { method: "sso", pending: { step: "verify", until: Date.now() + 1000, attempts: 0 } } };
    const { result, seen } = await capture("X-Arcus-Remote-User", (client) => runAs(pending, () => client.call("list_operations", {})));
    assert.ok(result instanceof AppError);
    assert.equal(seen.length, 0);
  });
});
