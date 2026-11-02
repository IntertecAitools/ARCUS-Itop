import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { runAs } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import {
  AutoCloseService,
  completeSettings,
  DEFAULT_AUTO_CLOSE,
  type AutoCloseScope,
  type AutoCloseSettings,
} from "../src/modules/auto-close/index.js";
import { autoCloseSettingsSchema } from "../src/modules/auto-close/auto-close.schemas.js";
import type { Mail, Mailer } from "../src/platform/auth/mailer.js";
import { CmdbSchema } from "../src/schema/load.js";
import { MemoryDocStore } from "../src/shared/doc-store.js";
import {
  FakeItopClient,
  getResponse,
  sampleDashboards,
  sampleNavigation,
  sampleSchema,
  testConfig,
} from "./helpers.js";

const TZ = "Europe/Paris";
const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));
/** 2 November 2026, 13:00 in Paris. Seven days back is 26 October 13:00; five is 28 October 13:00. */
const NOW = Date.parse("2026-11-02T12:00:00Z");

class CaptureMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}

const ok: ItopResult = { code: 0, message: "", objects: {} };

interface Ticket {
  class: "UserRequest" | "Incident";
  id: number;
  ref: string;
  resolved: string;
  caller?: number;
}

/** iTop with these resolved tickets; it answers the "resolved before" OQL as iTop would. */
function itop(tickets: Ticket[], people: Record<number, { first_name: string; email: string }> = {}) {
  const fake = new FakeItopClient();
  fake.on("core/get", (params) => {
    const key = String(params["key"]);
    if (params["class"] === "Person") {
      const ids = /IN \(([^)]*)\)/.exec(key)![1]!.split(",").map(Number);
      return getResponse(ids.filter((id) => people[id]).map((id) => ({ class: "Person", id, fields: people[id]! })));
    }
    const before = /resolution_date < '([^']+)'/.exec(key)![1]!;
    const from = /resolution_date >= '([^']+)'/.exec(key)?.[1] ?? "";
    return getResponse(
      tickets
        .filter((t) => t.class === params["class"] && t.resolved >= from && t.resolved < before)
        .map((t) => ({
          class: t.class,
          id: t.id,
          fields: { ref: t.ref, title: `Ticket ${t.ref}`, resolution_date: t.resolved, caller_id: String(t.caller ?? 0) },
        })),
    );
  });
  fake.on("core/apply_stimulus", ok);
  return fake;
}

function build(
  fake: FakeItopClient,
  options: {
    settings?: Partial<AutoCloseSettings>;
    mailer?: Mailer;
    scopes?: AutoCloseScope[];
    cmdb?: CmdbSchema;
    now?: () => number;
  } = {},
) {
  const store = new MemoryDocStore();
  if (options.settings) void store.put("", "auto-close", "settings", { ...DEFAULT_AUTO_CLOSE, ...options.settings }, "admin");
  const service = new AutoCloseService(
    fake.asClient(),
    options.cmdb ?? schema,
    store,
    async () => options.scopes ?? [{ key: "" }],
    TZ,
    "https://desk.example",
    0,
    options.mailer,
    undefined,
    options.now ?? (() => NOW),
  );
  return { service, store };
}

const stimuli = (fake: FakeItopClient) => fake.calls.filter((c) => c.verb === "core/apply_stimulus");

describe("auto-close settings", () => {
  it("default: on, 7 days, requests and incidents, a reminder 2 days before", () => {
    assert.deepEqual(completeSettings(undefined), {
      enabled: true,
      days: 7,
      requests: true,
      incidents: true,
      remind: true,
      remindDaysBefore: 2,
    });
  });

  it("a damaged document takes the default for what is wrong", () => {
    const s = completeSettings({ enabled: false, days: -3, requests: "yes", remindDaysBefore: 99 });
    assert.equal(s.enabled, false);
    assert.equal(s.days, 7);
    assert.equal(s.requests, true);
    assert.equal(s.remindDaysBefore, 2);
    // No room for a reminder before a one-day delay.
    assert.equal(completeSettings({ days: 1, remind: true }).remind, false);
  });

  it("refuses a reminder that would go on or after the closing day", () => {
    const base = { enabled: true, days: 3, requests: true, incidents: true, remind: true };
    assert.equal(autoCloseSettingsSchema.safeParse({ ...base, remindDaysBefore: 3 }).success, false);
    assert.equal(autoCloseSettingsSchema.safeParse({ ...base, remindDaysBefore: 2 }).success, true);
    // Off, the reminder's days do not matter.
    assert.equal(autoCloseSettingsSchema.safeParse({ ...base, remind: false, remindDaysBefore: 3 }).success, true);
    assert.equal(autoCloseSettingsSchema.safeParse({ ...base, days: 0, remindDaysBefore: 1 }).success, false);
  });
});

describe("the auto-close check", () => {
  const tickets: Ticket[] = [
    { class: "UserRequest", id: 11, ref: "R-000011", resolved: "2026-10-20 10:00:00", caller: 5 },
    { class: "UserRequest", id: 12, ref: "R-000012", resolved: "2026-10-27 09:00:00", caller: 5 },
    { class: "UserRequest", id: 13, ref: "R-000013", resolved: "2026-11-01 09:00:00", caller: 5 },
    { class: "Incident", id: 21, ref: "I-000021", resolved: "2026-10-25 08:00:00", caller: 6 },
  ];
  const people = { 5: { first_name: "Ana", email: "ana@acme.test" }, 6: { first_name: "Bo", email: "" } };

  it("closes what was resolved over 7 days ago, as the service account, with a note", async () => {
    const fake = itop(tickets, people);
    const { service } = build(fake);
    const run = await service.runCurrent();

    const closes = stimuli(fake);
    assert.deepEqual(
      closes.map((c) => [c.params["class"], c.params["key"], c.params["stimulus"], c.as]),
      [
        ["UserRequest", 11, "ev_close", "service"],
        ["Incident", 21, "ev_close", "service"],
      ],
    );
    assert.deepEqual(closes[0]!.params["fields"], {
      public_log: "Closed automatically after 7 days with no reply from the customer.",
    });
    // "Resolved over 7 days ago", on iTop's clock (Paris).
    const query = fake.calls.find((c) => c.params["class"] === "UserRequest")!.params["key"];
    assert.equal(query, "SELECT UserRequest WHERE status = 'resolved' AND resolution_date < '2026-10-26 13:00:00'");
    assert.deepEqual(
      run.outcomes.filter((o) => o.action === "closed").map((o) => o.ref),
      ["R-000011", "I-000021"],
    );
  });

  it("emails the caller once, 2 days before, with the closing day and the portal link", async () => {
    const fake = itop(tickets, people);
    const mailer = new CaptureMailer();
    const { service } = build(fake, { mailer });
    const run = await service.runCurrent();

    // Reminding reads, apart, those resolved between 7 and 5 days ago.
    assert.ok(
      fake.calls.some(
        (c) =>
          c.params["key"] ===
          "SELECT UserRequest WHERE status = 'resolved' AND resolution_date >= '2026-10-26 13:00:00' AND resolution_date < '2026-10-28 13:00:00'",
      ),
    );
    assert.equal(mailer.sent.length, 1);
    const mail = mailer.sent[0]!;
    assert.equal(mail.to, "ana@acme.test");
    assert.equal(mail.subject, "[R-000012] Resolved: Ticket R-000012");
    assert.match(mail.text, /Hello Ana,/);
    assert.match(mail.text, /closes by itself on Tuesday, 3 November 2026/);
    assert.match(mail.text, /https:\/\/desk\.example\/portal\/requests\/12/);
    assert.equal(mail.headers?.["Auto-Submitted"], "auto-generated");
    assert.deepEqual(
      run.outcomes.filter((o) => o.action === "reminded").map((o) => o.ref),
      ["R-000012"],
    );

    // The next check does not send it again.
    await service.runCurrent();
    assert.equal(mailer.sent.length, 1);
  });

  it("a ticket resolved again after a reopen gets a fresh reminder", async () => {
    const list = [{ class: "UserRequest" as const, id: 12, ref: "R-000012", resolved: "2026-10-27 09:00:00", caller: 5 }];
    const fake = itop(list, people);
    const mailer = new CaptureMailer();
    const { service } = build(fake, { mailer });
    await service.runCurrent();
    list[0]!.resolved = "2026-10-28 08:00:00";
    await service.runCurrent();
    assert.equal(mailer.sent.length, 2);
  });

  it("a caller without an address is reported, not retried every check", async () => {
    const list: Ticket[] = [{ class: "Incident", id: 22, ref: "I-000022", resolved: "2026-10-27 09:00:00", caller: 6 }];
    const fake = itop(list, people);
    const mailer = new CaptureMailer();
    const { service } = build(fake, { mailer });
    const first = await service.runCurrent();
    assert.deepEqual(first.outcomes.map((o) => [o.ref, o.action]), [["I-000022", "failed"]]);
    const second = await service.runCurrent();
    assert.deepEqual(second.outcomes, []);
    assert.equal(mailer.sent.length, 0);
  });

  it("without a mail server, or with the reminder off, only closes", async () => {
    for (const options of [{}, { mailer: new CaptureMailer(), settings: { remind: false } }]) {
      const fake = itop(tickets, people);
      const { service } = build(fake, options);
      const run = await service.runCurrent();
      assert.deepEqual(run.outcomes.map((o) => o.action), ["closed", "closed"]);
      assert.match(String(fake.calls[0]!.params["key"]), /resolution_date < '2026-10-26 13:00:00'/);
    }
  });

  it("does nothing when off, and leaves out a class that is not ticked", async () => {
    const off = itop(tickets, people);
    await build(off, { settings: { enabled: false } }).service.runCurrent();
    assert.equal(off.calls.length, 0);

    const requestsOnly = itop(tickets, people);
    await build(requestsOnly, { settings: { incidents: false } }).service.runCurrent();
    assert.ok(requestsOnly.calls.every((c) => c.params["class"] !== "Incident"));
    assert.deepEqual(stimuli(requestsOnly).map((c) => c.params["key"]), [11]);
  });

  it("honours a longer delay", async () => {
    const fake = itop(tickets, people);
    await build(fake, { settings: { days: 14, remind: false } }).service.runCurrent();
    assert.equal(stimuli(fake).length, 0);
  });

  it("a ticket the customer reopened or closed a moment ago fails alone; the rest still close", async () => {
    const fake = itop(tickets, people);
    fake.on("core/apply_stimulus", (params) =>
      params["key"] === 11 ? { code: 100, message: "Invalid stimulus: 'ev_close' on the object R-000011 in state 'assigned'" } : ok,
    );
    const run = await build(fake).service.runCurrent();
    assert.deepEqual(run.outcomes.map((o) => [o.ref, o.action]), [
      ["R-000011", "failed"],
      ["I-000021", "closed"],
    ]);
    assert.match(run.outcomes[0]!.reason ?? "", /Invalid stimulus/);
  });

  it("uses ev_autoclose when iTop's lifecycle has a transition for it", async () => {
    const cmdb = {
      get: () => ({ lifecycle: { transitions: { resolved: { ev_close: "closed", ev_autoclose: "closed" } } } }),
    } as unknown as CmdbSchema;
    const fake = itop(tickets, people);
    await build(fake, { cmdb }).service.runCurrent();
    assert.deepEqual(new Set(stimuli(fake).map((c) => c.params["stimulus"])), new Set(["ev_autoclose"]));
  });

  it("iTop's stock lifecycle has no ev_autoclose transition, so ev_close it is", () => {
    for (const cls of ["UserRequest", "Incident"]) {
      const resolved = schema.require(cls).lifecycle!.transitions["resolved"]!;
      assert.equal(resolved["ev_autoclose"], undefined, cls);
      assert.equal(resolved["ev_close"], "closed", cls);
    }
  });

  it("with tenancy: each tenant's own settings, and the platform's run skips the tenants' organisations", async () => {
    const fake = itop(tickets, people);
    const acme = { id: "acme", name: "Acme", orgIds: [3] };
    const { service, store } = build(fake, {
      scopes: [{ key: "acme", tenant: acme }, { key: "", excludeOrgIds: [3, 4] }],
    });
    await store.put("acme", "auto-close", "settings", { ...DEFAULT_AUTO_CLOSE, enabled: false }, "admin");

    await service.runAll();
    // Acme is off; only the platform's run read iTop, without Acme's and the other tenant's organisations.
    const keys = fake.calls.filter((c) => c.verb === "core/get").map((c) => String(c.params["key"]));
    assert.ok(keys.length > 0);
    assert.ok(keys.filter((k) => k.includes("status = 'resolved'")).every((k) => k.endsWith(" AND org_id NOT IN (3,4)")));

    // Settings are per tenant: Acme's admin sees Acme's.
    const seen = await runAs(undefined, () => service.get(), acme);
    assert.equal(seen.enabled, false);
    assert.equal((await service.get()).enabled, true);
  });
});

describe("auto-close routes", () => {
  function app(fake: FakeItopClient) {
    const cmdb = sampleSchema();
    const built = buildApp(testConfig(), {
      client: fake.asClient(),
      schema: cmdb,
      navigation: sampleNavigation(cmdb),
      dashboards: sampleDashboards(fake.asClient(), cmdb),
    });
    after(async () => {
      await built.app.close();
    });
    return built.app;
  }

  it("reads the defaults, saves a change, refuses a bad one", async () => {
    const server = app(new FakeItopClient());
    const first = await server.inject({ method: "GET", url: "/api/admin/auto-close" });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().days, 7);
    assert.equal(first.json().checkEveryMinutes, 0);

    const payload = { enabled: true, days: 10, requests: true, incidents: false, remind: true, remindDaysBefore: 3 };
    const saved = await server.inject({ method: "PUT", url: "/api/admin/auto-close", payload });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().days, 10);
    assert.equal(saved.json().incidents, false);

    const bad = await server.inject({ method: "PUT", url: "/api/admin/auto-close", payload: { ...payload, remindDaysBefore: 10 } });
    assert.equal(bad.statusCode, 400);
    assert.equal((await server.inject({ method: "GET", url: "/api/admin/auto-close" })).json().days, 10);
  });

  it("run now closes and reports", async () => {
    const fake = itop([{ class: "UserRequest", id: 11, ref: "R-000011", resolved: "2000-01-01 00:00:00" }]);
    const server = app(fake);
    const run = await server.inject({ method: "POST", url: "/api/admin/auto-close/run" });
    assert.equal(run.statusCode, 200);
    assert.deepEqual(run.json().outcomes.map((o: { ref: string; action: string }) => [o.ref, o.action]), [["R-000011", "closed"]]);
    assert.ok((await server.inject({ method: "GET", url: "/api/admin/auto-close" })).json().lastRun);
  });
});
