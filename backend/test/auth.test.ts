import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import type { ItopResult } from "../src/itop/types.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

/**
 * Sign-in, the guard, and calls made as the signed-in user.
 *
 * The decisive check is `as` on the recorded iTop calls: after Jane signs
 * in, a list request reaches iTop with HER account, not the service one.
 */

const account = (login: string, profiles: string[], extra: Record<string, unknown> = {}): ItopResult[] => [
  getResponse([
    {
      class: "UserLocal",
      id: 12,
      fields: { login, status: "enabled", contactid: "7", first_name: "Jane", last_name: "Doe", email: "jane@x.io", org_id: "3", ...extra },
    },
  ]),
  getResponse(profiles.map((profile, i) => ({ class: "URP_UserProfile", id: i + 1, fields: { profile } }))),
  getResponse([]),
];

function setup(responses: ItopResult[], options: { corsOrigins?: string[] } = {}) {
  const fake = new FakeItopClient()
    .on("core/get", responses)
    .on("list_operations", { code: 0, message: "Operations: 7", operations: [] });
  fake.passwords.set("jane", "s3cret-pass");
  const schema = sampleSchema();
  const { app } = buildApp(
    testConfig({
      auth: {
        required: true,
        sessionIdleMs: 3_600_000,
        sessionMaxMs: 3_600_000,
        cookieSecure: false,
        sessionStore: { kind: "memory" },
      },
      ...(options.corsOrigins ? { corsOrigins: options.corsOrigins } : {}),
    }),
    {
      client: fake.asClient(),
      schema,
      navigation: sampleNavigation(schema),
      dashboards: sampleDashboards(fake.asClient(), schema),
    },
  );
  after(async () => {
    await app.close();
  });
  return { app, fake };
}

async function signIn(app: ReturnType<typeof setup>["app"]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { login: "jane", password: "s3cret-pass" },
  });
  const cookie = String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "";
  return { res, cookie };
}

describe("sign-in", () => {
  it("refuses a wrong password with one message for every case", async () => {
    const { app } = setup(account("jane", ["Service Desk Agent"]));
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "jane", password: "nope" } });
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /Wrong login or password/);
  });

  it("starts an HttpOnly session and then calls iTop as that user", async () => {
    const { app, fake } = setup([
      ...account("jane", ["Service Desk Agent", "REST Services User"]),
      getResponse([{ class: "Server", id: 1, fields: { name: "web-01" } }]),
    ]);
    const { res, cookie } = await signIn(app);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(res.headers["set-cookie"]), /SameSite=Lax/);
    assert.equal(res.json().user.kind, "staff");
    assert.ok(!JSON.stringify(res.json()).includes("s3cret"), "the password never leaves the BFF");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    assert.equal(me.json().user.name, "Jane Doe");

    const list = await app.inject({ method: "GET", url: "/api/objects/Server", headers: { cookie } });
    assert.equal(list.statusCode, 200);
    assert.equal(fake.lastCall().as, "jane");
    // The sign-in lookups themselves ran as the service account.
    assert.equal(fake.calls[0]?.as, "service");
  });

  it("explains a staff account that lacks the REST profile", async () => {
    const { app, fake } = setup(account("jane", ["Service Desk Agent"]));
    fake.on("list_operations", { code: 1, message: "This user is not authorized to use the web services" });
    const { res } = await signIn(app);
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /REST Services User/);
  });

  it("signs an end user in, but keeps them to the self-service API", async () => {
    const { app, fake } = setup(account("jane", ["Portal user"]));
    const { res, cookie } = await signIn(app);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().user.kind, "portal");
    // No REST-access check for them: iTop's REST API refuses end users anyway.
    assert.ok(!fake.calls.some((c) => c.verb === "list_operations"));
    const staff = await app.inject({ method: "GET", url: "/api/objects/Server", headers: { cookie } });
    assert.equal(staff.statusCode, 403);
  });

  it("refuses a disabled account", async () => {
    const { app } = setup(account("jane", ["Service Desk Agent"], { status: "disabled" }));
    const { res } = await signIn(app);
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /disabled/);
  });
});

describe("the guard", () => {
  it("requires a session for the API, but not for health", async () => {
    const { app } = setup([]);
    assert.equal((await app.inject({ method: "GET", url: "/api/objects/Server" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  });

  it("keeps the admin API to administrators", async () => {
    const { app } = setup(account("jane", ["Service Desk Agent", "REST Services User"]));
    const { cookie } = await signIn(app);
    const res = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie } });
    assert.equal(res.statusCode, 403);
  });

  it("refuses a write from an origin outside the allowlist", async () => {
    const { app } = setup([], { corsOrigins: ["http://localhost:5173"] });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { login: "jane", password: "s3cret-pass" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("ends the session on sign-out", async () => {
    const { app } = setup(account("jane", ["Service Desk Agent", "REST Services User"]));
    const { cookie } = await signIn(app);
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    assert.equal(out.statusCode, 204);
    assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode, 401);
  });
});
