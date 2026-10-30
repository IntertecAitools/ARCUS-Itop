import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import {
  computePriority,
  DraftsService,
  inputsFor,
  MemoryDraftStore,
  MemoryTicketHandlingStore,
  parentField,
  parseCancelled,
  parseDuplicateRef,
  TicketHandlingService,
  titleSimilarity,
} from "../src/modules/ticket-handling/index.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const NOW = () => new Date("2026-10-29T10:00:00Z");

const staff = (profiles: string[], over: Partial<Caller> = {}): Caller =>
  ({
    userId: 5,
    login: "agent",
    contactId: 41,
    name: "Ann Agent",
    kind: "staff",
    profiles,
    isAdmin: false,
    allowedOrgIds: [],
    orgId: 1,
    email: "",
    credentials: { user: "agent", password: "x" },
    ...over,
  }) as Caller;
const support = staff(["Support Agent"]);
const desk = staff(["Service Desk Agent"]);
const portalUser = { ...staff(["Portal user"]), kind: "portal", userId: 9, name: "Rita Requester" } as Caller;

const ok: ItopResult = { code: 0, message: "", objects: {} };
const forbidden = (e: unknown) => e instanceof AppError && e.code === "forbidden";
const badRequest = (pattern: RegExp) => (e: unknown) => e instanceof AppError && e.code === "bad_request" && pattern.test(e.message);

/** A fake iTop holding a few tickets; core/get answers by the id in the OQL. */
function itopWith(tickets: Record<string, Record<string, unknown>>) {
  const fake = new FakeItopClient();
  fake.on("core/get", (params) => {
    const key = String(params["key"]);
    const cls = String(params["class"]);
    const id = /WHERE id = (\d+)/.exec(key)?.[1];
    if (id && tickets[`${cls}:${id}`]) {
      return getResponse([{ class: cls, id: Number(id), fields: tickets[`${cls}:${id}`]! }]);
    }
    return getResponse([]);
  });
  fake.on("core/update", (params) => {
    const fields = params["fields"] as Record<string, unknown>;
    if ("urgency" in fields) {
      const p = computePriority(Number(fields["impact"]), Number(fields["urgency"]));
      return getResponse([{ class: String(params["class"]), id: Number(params["key"]), fields: { priority: String(p), ...fields } }]);
    }
    return ok;
  });
  fake.on("core/apply_stimulus", ok);
  return fake;
}

const serviceWith = (fake: FakeItopClient, store = new MemoryTicketHandlingStore()) =>
  new TicketHandlingService(fake.asClient(), store, "Europe/Paris", NOW);

describe("priority matrix", () => {
  it("is iTop's impact × urgency table", () => {
    assert.equal(computePriority(1, 1), 1);
    assert.equal(computePriority(2, 3), 3);
    assert.equal(computePriority(3, 1), 2);
    assert.equal(computePriority(3, 4), 4);
  });

  it("moves urgency first, impact only when the row has no such priority", () => {
    assert.deepEqual(inputsFor(1, { impact: 2, urgency: 3 }), { impact: 2, urgency: 1 });
    assert.deepEqual(inputsFor(4, { impact: 2, urgency: 3 }), { impact: 2, urgency: 4 });
    // Impact 1 has no P3; impact 3 has no P1.
    assert.deepEqual(inputsFor(3, { impact: 1, urgency: 2 }), { impact: 2, urgency: 3 });
    assert.deepEqual(inputsFor(1, { impact: 3, urgency: 3 }), { impact: 2, urgency: 1 });
    for (const impact of [1, 2, 3]) {
      for (const urgency of [1, 2, 3, 4]) {
        for (const p of [1, 2, 3, 4]) {
          const pair = inputsFor(p, { impact, urgency })!;
          assert.equal(computePriority(pair.impact, pair.urgency), p);
        }
      }
    }
  });
});

describe("title similarity", () => {
  it("scores shared meaningful words, ignoring case, order, plurals and stop words", () => {
    assert.equal(titleSimilarity("Printer on floor 3 offline", "Floor 3 printers are OFFLINE"), 1);
    assert.ok(titleSimilarity("VPN keeps dropping", "VPN dropping every hour") >= 0.4);
    assert.equal(titleSimilarity("Laptop screen broken", "Payroll export fails"), 0);
    assert.equal(titleSimilarity("", "anything"), 0);
  });
});

describe("solution markers", () => {
  it("recognises a cancellation and a duplicate in iTop's HTML solution", () => {
    assert.deepEqual(parseCancelled("<p>Cancelled by Rita (requester): no longer needed &amp; done</p>"), {
      by: "Rita (requester)",
      reason: "no longer needed & done",
    });
    assert.equal(parseCancelled("<p>Fixed the printer</p>"), undefined);
    assert.equal(parseDuplicateRef("<p>Duplicate of I-000123: same outage</p>"), "I-000123");
    assert.equal(parseDuplicateRef("<p>Duplicate of R-000007.</p>"), "R-000007");
  });

  it("links through the parent field iTop has", () => {
    assert.equal(parentField("Incident", "Incident"), "parent_incident_id");
    assert.equal(parentField("UserRequest", "Incident"), "parent_incident_id");
    assert.equal(parentField("UserRequest", "UserRequest"), "parent_request_id");
    assert.equal(parentField("Incident", "UserRequest"), undefined);
  });
});

describe("priority override", () => {
  it("changes urgency so iTop computes the priority, logs the reason privately and keeps the record", async () => {
    const fake = itopWith({
      "Incident:7": { ref: "I-000007", title: "Mail down", status: "assigned", priority: "3", impact: "2", urgency: "3", solution: "" },
    });
    const store = new MemoryTicketHandlingStore();
    await runAs(support, () => serviceWith(fake, store).overridePriority("Incident", 7, { priority: "critical", reason: "CEO cannot email" }));

    const update = fake.calls.find((c) => c.verb === "core/update")!;
    const fields = update.params["fields"] as Record<string, unknown>;
    assert.equal(fields["impact"], "2");
    assert.equal(fields["urgency"], "1");
    assert.match(String(fields["private_log"]), /Medium to Critical by Ann Agent: CEO cannot email \(urgency 3 → 1/);
    assert.equal(update.as, "agent");

    const saved = await store.latestOverride("", "Incident", 7);
    assert.equal(saved?.from, "medium");
    assert.equal(saved?.to, "critical");
    assert.equal(saved?.urgencyFrom, "3");
  });

  it("needs a reason, an open ticket and a different priority", async () => {
    const fake = itopWith({
      "Incident:7": { ref: "I-000007", status: "assigned", priority: "3", impact: "2", urgency: "3" },
      "Incident:8": { ref: "I-000008", status: "resolved", priority: "3", impact: "2", urgency: "3" },
    });
    const svc = serviceWith(fake);
    await assert.rejects(svc.overridePriority("Incident", 7, { priority: "high", reason: " " }), badRequest(/why/));
    await assert.rejects(svc.overridePriority("Incident", 7, { priority: "medium", reason: "same" }), badRequest(/already/));
    await assert.rejects(svc.overridePriority("Incident", 8, { priority: "high", reason: "late" }), badRequest(/resolved/));
  });

  it("shows the override as no longer in force once impact or urgency were reassessed", async () => {
    const tickets: Record<string, Record<string, unknown>> = {
      "UserRequest:3": { ref: "R-000003", status: "assigned", priority: "4", impact: "3", urgency: "4", solution: "" },
    };
    const fake = itopWith(tickets);
    fake.on("core/get", (params) => {
      const key = String(params["key"]);
      if (key.includes("WHERE id = 3")) return getResponse([{ class: "UserRequest", id: 3, fields: tickets["UserRequest:3"]! }]);
      return getResponse([]);
    });
    const store = new MemoryTicketHandlingStore();
    const svc = serviceWith(fake, store);
    await svc.overridePriority("UserRequest", 3, { priority: "high", reason: "VIP" });
    Object.assign(tickets["UserRequest:3"]!, { impact: "3", urgency: "1", priority: "2" });
    assert.equal((await svc.summary("UserRequest", 3)).override?.active, true);
    Object.assign(tickets["UserRequest:3"]!, { urgency: "2", priority: "3" });
    assert.equal((await svc.summary("UserRequest", 3)).override?.active, false);
  });
});

describe("duplicates", () => {
  const tickets = () => ({
    "UserRequest:20": { ref: "R-000020", title: "VPN down", status: "dispatched", solution: "" },
    "UserRequest:21": { ref: "R-000021", title: "VPN is down", status: "assigned", solution: "" },
    "Incident:30": { ref: "I-000030", title: "VPN outage", status: "assigned", solution: "" },
    "Incident:31": { ref: "I-000031", title: "Dup", status: "resolved", solution: "<p>Duplicate of I-000030.</p>", parent_incident_id: "30" },
  });

  it("resolves the duplicate from any open state with ev_autoresolve, linked to the original", async () => {
    const fake = itopWith(tickets());
    await runAs(support, () =>
      serviceWith(fake).markDuplicate("UserRequest", 20, { originalClass: "UserRequest", originalId: 21, note: "same caller" }),
    );
    const stimulus = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(stimulus.params["stimulus"], "ev_autoresolve");
    const fields = stimulus.params["fields"] as Record<string, unknown>;
    assert.equal(fields["parent_request_id"], 21);
    assert.equal(fields["solution"], "Duplicate of R-000021: same caller");
    assert.equal(fields["resolution_code"], "other");
    assert.match(String(fields["private_log"]), /Marked as a duplicate of R-000021 by Ann Agent/);
    // A note on the original as well.
    const note = fake.calls.find((c) => c.verb === "core/update" && c.params["key"] === 21);
    assert.match(String((note?.params["fields"] as Record<string, unknown>)["private_log"]), /R-000020 was marked/);
  });

  it("refuses what iTop cannot link, a chain of duplicates, and a profile that cannot resolve", async () => {
    const svc = serviceWith(itopWith(tickets()));
    await assert.rejects(
      svc.markDuplicate("Incident", 30, { originalClass: "UserRequest", originalId: 21 }),
      badRequest(/only be a duplicate of another incident/),
    );
    await assert.rejects(
      svc.markDuplicate("UserRequest", 20, { originalClass: "UserRequest", originalId: 20 }),
      badRequest(/itself/),
    );
    await assert.rejects(
      svc.markDuplicate("UserRequest", 20, { originalClass: "Incident", originalId: 31 }),
      badRequest(/itself a duplicate of I-000030/),
    );
    await assert.rejects(
      runAs(desk, () => svc.markDuplicate("UserRequest", 20, { originalClass: "UserRequest", originalId: 21 })),
      forbidden,
    );
  });

  it("suggests open tickets by caller, CI, service and title, best first", async () => {
    const fake = new FakeItopClient();
    fake.on("core/get", (params) => {
      const cls = String(params["class"]);
      if (cls === "lnkFunctionalCIToTicket") {
        return getResponse([{ class: cls, id: 1, fields: { ticket_id: "40" } }]);
      }
      if (cls === "Incident") {
        return getResponse([
          { class: cls, id: 40, fields: { ref: "I-000040", title: "Mail server slow", status: "assigned", caller_id: "8", service_id: "0", start_date: "2026-10-29 09:00:00" } },
          { class: cls, id: 41, fields: { ref: "I-000041", title: "Outlook cannot send mail", status: "new", caller_id: "3", service_id: "5", start_date: "2026-10-29 09:00:00" } },
          { class: cls, id: 42, fields: { ref: "I-000042", title: "Printer jam", status: "new", caller_id: "8", service_id: "0", start_date: "2026-10-29 09:00:00" } },
        ]);
      }
      return getResponse([]);
    });
    const items = await serviceWith(fake).suggestDuplicates({
      class: "Incident",
      title: "Cannot send mail from Outlook",
      orgId: 2,
      callerId: 3,
      serviceId: 5,
      ciIds: [99],
    });
    assert.deepEqual(items.map((i) => i.ref), ["I-000041", "I-000040"]);
    assert.deepEqual(items[0]?.reasons, ["same caller", "same service", "similar title"]);
    assert.ok(items[1]?.reasons.includes("same CI"));
    const query = String(fake.calls.find((c) => c.params["class"] === "Incident")?.params["key"]);
    assert.match(query, /status NOT IN \('resolved','closed','rejected'\)/);
    assert.match(query, /org_id = 2/);
    // An incident can only duplicate an incident: requests are not searched.
    assert.equal(fake.calls.some((c) => c.params["class"] === "UserRequest"), false);
  });
});

describe("cancel", () => {
  it("resolves with the reason then closes, for staff who may resolve and close", async () => {
    const fake = itopWith({ "Incident:7": { status: "dispatched" } });
    await runAs(support, () => serviceWith(fake).cancel("Incident", 7, "Raised by mistake"));
    const stimuli = fake.calls.filter((c) => c.verb === "core/apply_stimulus");
    assert.deepEqual(stimuli.map((c) => c.params["stimulus"]), ["ev_autoresolve", "ev_close"]);
    const fields = stimuli[0]!.params["fields"] as Record<string, unknown>;
    assert.equal(fields["solution"], "Cancelled by Ann Agent: Raised by mistake");
    assert.equal(fields["resolution_code"], "other");
    assert.equal(stimuli[0]!.as, "agent");
  });

  it("is refused to a Service Desk Agent, without a reason, and once the ticket is done", async () => {
    const fake = itopWith({ "Incident:7": { status: "new" }, "Incident:8": { status: "closed" } });
    const svc = serviceWith(fake);
    await assert.rejects(runAs(desk, () => svc.cancel("Incident", 7, "Raised by mistake")), forbidden);
    await assert.rejects(svc.cancel("Incident", 7, ""), badRequest(/why/));
    await assert.rejects(svc.cancel("Incident", 8, "late"), badRequest(/already closed/));
    assert.equal(fake.calls.filter((c) => c.verb === "core/apply_stimulus").length, 0);
  });

  it("runs as the service account for a requester, naming them", async () => {
    const fake = itopWith({ "UserRequest:4": { status: "new" } });
    await runAs(portalUser, () => serviceWith(fake).cancel("UserRequest", 4, "Sorted it myself", portalUser));
    const first = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(first.as, "service");
    assert.match(String((first.params["fields"] as Record<string, unknown>)["solution"]), /^Cancelled by Rita Requester \(requester\): Sorted/);
  });
});

describe("worklogs", () => {
  it("logs time per entry and totals it per ticket and per agent", async () => {
    const fake = itopWith({ "Incident:7": { ref: "I-000007", org_id: "2" } });
    const svc = serviceWith(fake);
    const bob = staff(["Support Agent"], { userId: 6, name: "Bob" });
    await runAs(support, () => svc.logTime("Incident", 7, { minutes: 30, note: "Diagnosed" }));
    await runAs(bob, () => svc.logTime("Incident", 7, { minutes: 45, note: "Fixed", workDate: "2026-10-28" }));
    const log = await runAs(support, () => svc.logTime("Incident", 7, { minutes: 15, note: "Called back" }));

    assert.equal(log.totalMinutes, 90);
    assert.deepEqual(log.byAgent.map((a) => [a.name, a.minutes, a.entries]), [["Ann Agent", 45, 2], ["Bob", 45, 1]]);
    assert.equal(log.entries.find((e) => e.agent.name === "Bob")?.mine, false);
    assert.equal(log.entries[0]?.workDate.length, 10);

    const report = await runAs(support, () => svc.report({}));
    assert.equal(report.totalMinutes, 90);
    assert.equal(report.to, "2026-10-29");
    assert.equal(report.from, "2026-09-30");
    assert.deepEqual(report.byTicket, [{ class: "Incident", ticketId: 7, ticketRef: "I-000007", minutes: 90, entries: 3 }]);
  });

  it("checks the entry, and lets only its author or an administrator remove it", async () => {
    const fake = itopWith({ "Incident:7": { ref: "I-000007", org_id: "2" } });
    const svc = serviceWith(fake);
    await assert.rejects(svc.logTime("Incident", 7, { minutes: 0, note: "x" }), badRequest(/1 minute/));
    await assert.rejects(svc.logTime("Incident", 7, { minutes: 10, note: " " }), badRequest(/what was done/));
    await assert.rejects(svc.logTime("Incident", 7, { minutes: 10, note: "x", workDate: "2026-10-30" }), badRequest(/future/));
    await assert.rejects(runAs(portalUser, () => svc.logTime("Incident", 7, { minutes: 10, note: "x" })), forbidden);

    const log = await runAs(support, () => svc.logTime("Incident", 7, { minutes: 10, note: "x" }));
    const id = log.entries[0]!.id;
    await assert.rejects(runAs(staff(["Support Agent"], { userId: 6 }), () => svc.deleteTime(id)), forbidden);
    const after = await runAs(staff(["Support Agent"], { userId: 6, isAdmin: true }), () => svc.deleteTime(id));
    assert.equal(after.entries.length, 0);
  });

  it("keeps the report to the organisations the account may see", async () => {
    const fake = itopWith({ "Incident:7": { ref: "I-000007", org_id: "2" }, "Incident:8": { ref: "I-000008", org_id: "3" } });
    const svc = serviceWith(fake);
    await svc.logTime("Incident", 7, { minutes: 10, note: "a" });
    await svc.logTime("Incident", 8, { minutes: 20, note: "b" });
    const report = await runAs(staff(["Support Agent"], { allowedOrgIds: [3] }), () => svc.report({}));
    assert.equal(report.totalMinutes, 20);
  });
});

describe("drafts", () => {
  const svc = () => new DraftsService(new MemoryDraftStore(), NOW);

  it("keeps each user's drafts to themselves", async () => {
    const drafts = svc();
    const mine = await runAs(support, () => drafts.create({ kind: "incident", data: { title: "Half done", impact: "2" } }));
    assert.equal(mine.title, "Half done");
    const other = staff(["Support Agent"], { userId: 77 });
    assert.deepEqual(await runAs(other, () => drafts.list()), []);
    await assert.rejects(runAs(other, () => drafts.get(mine.id)), (e: unknown) => e instanceof AppError && e.code === "not_found");

    const updated = await runAs(support, () => drafts.update(mine.id, { kind: "incident", data: { title: "Nearly done" } }));
    assert.equal(updated.title, "Nearly done");
    assert.deepEqual((await runAs(support, () => drafts.list())).map((d) => d.title), ["Nearly done"]);
    await runAs(support, () => drafts.remove(mine.id));
    assert.deepEqual(await runAs(support, () => drafts.list()), []);
  });

  it("gives end users the portal form only, and staff the staff forms only", async () => {
    const drafts = svc();
    await assert.rejects(runAs(portalUser, () => drafts.create({ kind: "incident", data: {} })), forbidden);
    await assert.rejects(runAs(support, () => drafts.create({ kind: "portal-request", data: {} })), forbidden);
    const d = await runAs(portalUser, () => drafts.create({ kind: "portal-request", data: {} }));
    assert.equal(d.title, "Untitled draft");
  });

  it("refuses an oversized draft", async () => {
    await assert.rejects(
      runAs(support, () => svc().create({ kind: "incident", data: { description: "x".repeat(70_000) } })),
      badRequest(/limited/),
    );
  });
});
