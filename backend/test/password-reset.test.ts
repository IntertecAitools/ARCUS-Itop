import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PasswordResetConfig } from "../src/config/env.js";
import type { Caller } from "../src/core/request-context.js";
import { badRequest } from "../src/core/errors.js";
import type { ItopClient } from "../src/itop/client.js";
import { AuthService } from "../src/platform/auth/auth.service.js";
import type { Mail, Mailer } from "../src/platform/auth/mailer.js";
import { PasswordResetService } from "../src/platform/auth/password-reset.service.js";
import { MemoryResetTokenStore } from "../src/platform/auth/reset-token.store.js";
import { MemorySessionStore } from "../src/platform/auth/session.store.js";
import { buildApp } from "../src/app.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

const CONFIG: PasswordResetConfig = {
  smtp: { host: "smtp.test", port: 587, secure: false, requireTls: true },
  from: "Helpdesk <helpdesk@example.test>",
  appBaseUrl: "https://help.example.test",
  tokenTtlMs: 30 * 60_000,
};

interface Account {
  id: number;
  class: "UserLocal" | "UserLDAP";
  login: string;
  email: string;
  status: "enabled" | "disabled";
}

const ACCOUNTS: Account[] = [
  { id: 5, class: "UserLocal", login: "paul", email: "paul@example.test", status: "enabled" },
  { id: 6, class: "UserLocal", login: "off", email: "off@example.test", status: "disabled" },
  { id: 7, class: "UserLDAP", login: "ldapuser", email: "ldap@example.test", status: "enabled" },
  { id: 8, class: "UserLocal", login: "nomail", email: "", status: "enabled" },
];

/** Answers the OQL the service and AuthService send, from ACCOUNTS. */
function fakeItop() {
  const passwords = new Map<number, string>();
  const objects = (rows: Account[]) =>
    Object.fromEntries(
      rows.map((a) => [
        `${a.class}::${a.id}`,
        {
          code: 0,
          message: "",
          class: a.class,
          key: String(a.id),
          fields: { id: String(a.id), login: a.login, email: a.email, first_name: "P", last_name: a.login },
        },
      ]),
    );
  const client = {
    async call(verb: string, params: Record<string, unknown>) {
      if (verb === "core/update") {
        const pw = String((params["fields"] as Record<string, unknown>)["password"]);
        if (pw === "rejected-by-itop") throw badRequest("Password does not meet the policy.");
        passwords.set(Number(params["key"]), pw);
        return { code: 0, message: "", objects: {} };
      }
      const key = params["key"];
      if (typeof key === "number") {
        return { code: 0, message: "", objects: objects(ACCOUNTS.filter((a) => a.id === key)) };
      }
      const oql = String(key);
      // quoteString escapes with backslashes; undo that to compare.
      const value = (/= '((?:[^'\\]|\\.)*)'/.exec(oql)?.[1] ?? "").replace(/\\(.)/g, "$1");
      const local = ACCOUNTS.filter((a) => a.class === "UserLocal" && a.status === "enabled");
      const hits = oql.includes("login =")
        ? local.filter((a) => a.login === value)
        : local.filter((a) => a.email === value);
      return { code: 0, message: `Found: ${hits.length}`, objects: objects(hits) };
    },
  };
  return { client: client as unknown as ItopClient, passwords };
}

function setup() {
  const itop = fakeItop();
  const sent: Mail[] = [];
  const mailer: Mailer = {
    send: async (m) => {
      sent.push(m);
    },
  };
  const sessions = new MemorySessionStore(3_600_000, 3_600_000);
  const service = new PasswordResetService(
    itop.client,
    new AuthService(itop.client),
    new MemoryResetTokenStore(),
    sessions,
    mailer,
    CONFIG,
  );
  const tokenFrom = (mail: Mail) => /#token=([\w-]+)/.exec(mail.text)?.[1] ?? "";
  return { ...itop, sent, service, sessions, tokenFrom };
}

describe("password reset", () => {
  it("emails a one-time link, with the token in the fragment, to the account's address", async () => {
    const { service, sent } = setup();
    await service.request("paul", "1.2.3.4")();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "paul@example.test");
    assert.match(sent[0]!.text, /https:\/\/help\.example\.test\/reset-password#token=[\w-]{43}/);
  });

  it("finds the account by email address too", async () => {
    const { service, sent } = setup();
    await service.request("paul@example.test", "1.2.3.4")();
    assert.equal(sent[0]?.to, "paul@example.test");
  });

  it("sends nothing for accounts that cannot be reset", async () => {
    const { service, sent } = setup();
    for (const who of ["nobody", "off", "ldapuser", "nomail"]) {
      await service.request(who, "1.2.3.4")();
    }
    assert.equal(sent.length, 0);
  });

  it("sets the password once, then the link is dead and the account is signed out", async () => {
    const { service, sent, passwords, sessions, tokenFrom } = setup();
    const sid = await sessions.create({ userId: 5, login: "paul" } as Caller);
    await service.request("paul", "1.2.3.4")();
    const token = tokenFrom(sent[0]!);

    await service.reset(token, "a-new-password");
    assert.equal(passwords.get(5), "a-new-password");
    assert.equal(await sessions.get(sid), undefined);
    await assert.rejects(() => service.reset(token, "another-password"), /expired or was already used/);
  });

  it("keeps the link usable when the password is refused", async () => {
    const { service, sent, passwords, tokenFrom } = setup();
    await service.request("paul", "1.2.3.4")();
    const token = tokenFrom(sent[0]!);
    await assert.rejects(() => service.reset(token, "rejected-by-itop"), /policy/);
    await assert.rejects(() => service.reset(token, "short"), /at least 8/);
    await service.reset(token, "good-password");
    assert.equal(passwords.get(5), "good-password");
  });

  it("replaces an earlier link with a newer one", async () => {
    const { service, sent, tokenFrom } = setup();
    await service.request("paul", "1.2.3.4")();
    await service.request("paul", "1.2.3.4")();
    await assert.rejects(() => service.reset(tokenFrom(sent[0]!), "a-new-password"), /expired/);
    await service.reset(tokenFrom(sent[1]!), "a-new-password");
  });

  it("refuses a made-up or empty token", async () => {
    const { service } = setup();
    await assert.rejects(() => service.reset("x".repeat(43), "a-new-password"), /expired/);
    await assert.rejects(() => service.reset("", "a-new-password"), /expired/);
  });

  it("limits requests per account silently, and per address with an error", async () => {
    const { service, sent } = setup();
    for (let i = 0; i < 5; i++) await service.request("paul", `10.0.0.${i}`)();
    assert.equal(sent.length, 3);

    for (let i = 0; i < 10; i++) service.request(`user${i}`, "9.9.9.9");
    assert.throws(() => service.request("paul", "9.9.9.9"), /Too many requests/);
  });

  it("puts the login in the email without letting it inject HTML", async () => {
    const { service, sent } = setup();
    ACCOUNTS.push({ id: 9, class: "UserLocal", login: "<b>x</b>", email: "x@example.test", status: "enabled" });
    try {
      await service.request("<b>x</b>", "1.2.3.4")();
    } finally {
      ACCOUNTS.pop();
    }
    assert.ok(sent[0]!.html.includes("&#60;b&#62;x&#60;/b&#62;"));
    assert.ok(!sent[0]!.html.includes("<b><b>"));
  });

  it("is off without a mail server", () => {
    const itop = fakeItop();
    const service = new PasswordResetService(
      itop.client,
      new AuthService(itop.client),
      new MemoryResetTokenStore(),
      new MemorySessionStore(1, 1),
      undefined,
      undefined,
    );
    assert.equal(service.enabled, false);
    assert.throws(() => service.request("paul", "1.2.3.4"), /not set up/);
  });
});

describe("password reset routes", () => {
  function app(withMail: boolean) {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const schema = sampleSchema();
    const sent: Mail[] = [];
    const { app } = buildApp(
      testConfig({
        auth: {
          required: true,
          sessionIdleMs: 3_600_000,
          sessionMaxMs: 3_600_000,
          cookieSecure: false,
          sessionStore: { kind: "memory" },
          ...(withMail ? { passwordReset: CONFIG } : {}),
        },
      }),
      {
        client: fake.asClient(),
        schema,
        navigation: sampleNavigation(schema),
        dashboards: sampleDashboards(fake.asClient(), schema),
        ...(withMail ? { mailer: { send: async (m: Mail) => void sent.push(m) } } : {}),
      },
    );
    return { app, sent };
  }

  it("tells the sign-in page whether reset is on, without a session", async () => {
    const on = await app(true).app.inject({ method: "GET", url: "/api/auth/options" });
    assert.deepEqual(on.json(), { passwordReset: true });
    const off = await app(false).app.inject({ method: "GET", url: "/api/auth/options" });
    assert.deepEqual(off.json(), { passwordReset: false });
  });

  it("answers an unknown account exactly like a real one, without a session", async () => {
    const res = await app(true).app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { identifier: "nobody-here" },
    });
    assert.equal(res.statusCode, 202);
    assert.match(res.json().message, /If an account matches/);
  });

  it("refuses a bad link without a session, and 404s when reset is off", async () => {
    const bad = await app(true).app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token: "nope", password: "a-new-password" },
    });
    assert.equal(bad.statusCode, 400);
    const off = await app(false).app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { identifier: "paul" },
    });
    assert.equal(off.statusCode, 404);
  });
});
