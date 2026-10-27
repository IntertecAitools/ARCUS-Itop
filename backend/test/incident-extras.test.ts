import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { IncidentsService, TicketExtras } from "../src/modules/incidents/index.js";
import { stakeholderMail } from "../src/modules/incidents/stakeholder-mail.js";
import { isDay } from "../src/modules/incidents/ticket-extras.js";
import { incidentListQuerySchema, transitionSchema } from "../src/modules/incidents/incidents.schemas.js";
import type { Mail, Mailer } from "../src/platform/auth/mailer.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import type { CmdbSchema } from "../src/schema/load.js";
import type { DefaultOrganization } from "../src/shared/default-organization.js";
import { FakeItopClient, getResponse } from "./helpers.js";

/** Noon on 2026-10-27 in Paris: "today" for every test here. */
const NOW = () => new Date("2026-10-27T11:00:00Z");

const missingAttribute = { code: 100, message: "Unknown attribute next_action_date" };

function extrasWith(fake: FakeItopClient) {
  return new TicketExtras(fake.asClient(), "Europe/Paris", NOW);
}

describe("TicketExtras", () => {
  it("detects the extension with a query that can match nothing, and keeps a yes", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const extras = extrasWith(fake);
    assert.equal(await extras.available("Incident"), true);
    assert.equal(await extras.available("Incident"), true);
    assert.equal(fake.calls.length, 1);
    assert.match(String(fake.calls[0]?.params["key"]), /next_action_date > '2000-01-01'/);
  });

  it("reports a missing extension and asks again later rather than at every call", async () => {
    const fake = new FakeItopClient().on("core/get", missingAttribute);
    const extras = extrasWith(fake);
    assert.equal(await extras.available("UserRequest"), false);
    assert.equal(await extras.available("UserRequest"), false);
    assert.equal(fake.calls.length, 1);
  });

  it("reads why and until when a ticket waits, and flags a passed date as overdue", async () => {
    const fake = new FakeItopClient().on("core/get", [
      getResponse([]),
      getResponse([
        { class: "Incident", id: 1, fields: { status: "pending", pending_reason: "Waiting for vendor", next_action_date: "2026-10-26", major_incident: "no" } },
        { class: "Incident", id: 2, fields: { status: "pending", pending_reason: "Caller away", next_action_date: "2026-10-27", major_incident: "yes" } },
        { class: "Incident", id: 3, fields: { status: "assigned", pending_reason: "old", next_action_date: "2026-01-01", major_incident: "no" } },
      ]),
    ]);
    const rows = await extrasWith(fake).read("Incident", ["1", "2", "3"]);
    assert.deepEqual(rows.get("1"), {
      pending: { reason: "Waiting for vendor", nextActionDate: "2026-10-26", overdue: true },
      major: false,
    });
    // Due today is not overdue yet.
    assert.equal(rows.get("2")?.pending?.overdue, false);
    assert.equal(rows.get("2")?.major, true);
    // A stale date on a ticket no longer on hold is not shown at all.
    assert.equal(rows.get("3")?.pending, undefined);
    assert.equal(fake.calls[1]?.params["output_fields"], "status,pending_reason,next_action_date,major_incident");
  });

  it("still reads iTop's own pending reason without the extension", async () => {
    const fake = new FakeItopClient().on("core/get", [
      missingAttribute,
      getResponse([{ class: "UserRequest", id: 5, fields: { status: "pending", pending_reason: "Parts on order" } }]),
    ]);
    const rows = await extrasWith(fake).read("UserRequest", ["5"]);
    assert.deepEqual(rows.get("5"), { pending: { reason: "Parts on order", overdue: false } });
    assert.equal(fake.calls[1]?.params["output_fields"], "status,pending_reason");
  });

  it("puts a ticket on hold with iTop's stimulus, its reason and the date", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([]))
      .on("core/apply_stimulus", getResponse([{ class: "UserRequest", id: 9, fields: {} }]));
    await extrasWith(fake).hold("UserRequest", "9", {
      reason: " Waiting for the caller ",
      nextActionDate: "2026-10-30",
      comment: "Asked for logs",
    });
    const call = fake.calls.find((c) => c.verb === "core/apply_stimulus");
    assert.equal(call?.params["stimulus"], "ev_pending");
    assert.deepEqual(call?.params["fields"], {
      pending_reason: "Waiting for the caller",
      next_action_date: "2026-10-30",
      public_log: "Asked for logs",
    });
  });

  it("refuses a hold without a reason, with a malformed date or one in the past", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const extras = extrasWith(fake);
    const status = async (input: { reason: string; nextActionDate: string }) => {
      try {
        await extras.hold("Incident", "1", input);
        return "ok";
      } catch (error) {
        return (error as AppError).message;
      }
    };
    assert.match(await status({ reason: "  ", nextActionDate: "2026-10-30" }), /why/);
    assert.match(await status({ reason: "x", nextActionDate: "2026-02-30" }), /YYYY-MM-DD/);
    assert.match(await status({ reason: "x", nextActionDate: "30/10/2026" }), /YYYY-MM-DD/);
    assert.match(await status({ reason: "x", nextActionDate: "2026-10-26" }), /past/);
    assert.equal(fake.calls.filter((c) => c.verb === "core/apply_stimulus").length, 0);
  });

  it("answers 409 naming the extension when iTop lacks it", async () => {
    const fake = new FakeItopClient().on("core/get", missingAttribute);
    await assert.rejects(
      extrasWith(fake).hold("Incident", "1", { reason: "x", nextActionDate: "2026-10-30" }),
      (error: AppError) => error.code === "conflict" && /arcus-incident-extras/.test(error.message),
    );
  });

  it("writes the major flag as iTop's enum", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([]))
      .on("core/update", getResponse([{ class: "Incident", id: 4, fields: {} }]));
    await extrasWith(fake).setMajor("4", true);
    const call = fake.calls.find((c) => c.verb === "core/update");
    assert.deepEqual(call?.params["fields"], { major_incident: "yes" });
  });

  it("knows a real day from the shape of one", () => {
    assert.equal(isDay("2026-10-31"), true);
    assert.equal(isDay("2026-11-31"), false);
    assert.equal(isDay("2026-1-5"), false);
  });
});

/* ------------------------------------------------------------------------ *
 * IncidentsService with the extension
 * ------------------------------------------------------------------------ */

const LIFECYCLE = {
  attribute: "status",
  states: {
    assigned: ["ev_pending", "ev_resolve", "ev_reassign"],
    pending: ["ev_assign"],
  },
};
const schemaStub = { get: () => ({ lifecycle: LIFECYCLE }) } as unknown as CmdbSchema;
const defaultOrg = { resolve: async () => "1" } as unknown as DefaultOrganization;

interface Row {
  class: string;
  id: number;
  label: string;
  fields: Record<string, unknown>;
}

const incident = (id: number, fields: Record<string, unknown> = {}): Row => ({
  class: "Incident",
  id,
  label: `I-${id}`,
  fields: { ref: `I-00000${id}`, title: `Incident ${id}`, status: "assigned", priority: "2", ...fields },
});

/**
 * A small in-memory iTop behind ObjectsService's surface: enough OQL
 * (`id = n`, `id IN (…)`, `parent_incident_id = n`) for the service's reads.
 */
function world(rows: Row[], options: { major?: Set<string>; available?: boolean } = {}) {
  const writes: Array<{ id: number; fields: Record<string, unknown> }> = [];
  const lists: string[] = [];
  const holds: Array<{ id: string; reason: string; nextActionDate: string }> = [];
  const major = options.major ?? new Set<string>();
  const people: Row[] = [
    { class: "Person", id: 50, label: "Ana", fields: { email: "ana@example.com" } },
    { class: "Person", id: 51, label: "Ben", fields: { email: "ben@example.com" } },
  ];

  const select = (oql: string): Row[] => {
    const all = oql.includes("SELECT Person") ? people : rows;
    let m = /parent_incident_id = (\d+)/.exec(oql);
    if (m) return all.filter((r) => String(r.fields["parent_incident_id"] ?? "0") === m![1]);
    m = /id IN \(([\d,]+)\)/.exec(oql);
    if (m) {
      const ids = m[1]!.split(",");
      return all.filter((r) => ids.includes(String(r.id)));
    }
    m = /id = (\d+)/.exec(oql);
    if (m) return all.filter((r) => String(r.id) === m![1]);
    return all;
  };

  const page = (items: Row[]) => ({ items, page: 1, limit: 25, total: items.length, pages: 1, hasMore: false, sortedInBff: false });
  const objects = {
    list: async (_c: string, query: { oql: string }) => {
      lists.push(query.oql);
      return page(select(query.oql));
    },
    listAll: async (_c: string, query: { oql: string }) => page(select(query.oql)),
    update: async (_c: string, id: number, fields: Record<string, unknown>) => {
      writes.push({ id, fields });
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row.fields, fields);
      return { object: row, rejected: [] };
    },
  } as unknown as ObjectsService;

  const extras = {
    available: async () => options.available ?? true,
    overdueCondition: () => "status = 'pending' AND next_action_date < '2026-10-27'",
    read: async (_c: string, ids: string[]) =>
      new Map(ids.map((id) => [id, { major: major.has(id) }])),
    hold: async (_c: string, id: string, input: { reason: string; nextActionDate: string }) => {
      holds.push({ id, ...input });
    },
    setMajor: async (id: string, value: boolean) => {
      if (value) major.add(id);
      else major.delete(id);
    },
  } as unknown as TicketExtras;

  const sent: Mail[] = [];
  const mailer: Mailer = { send: async (mail) => void sent.push(mail) };
  const svc = new IncidentsService(objects, schemaStub, defaultOrg, extras, mailer);
  return { svc, writes, lists, holds, sent, major };
}

describe("IncidentsService: on hold", () => {
  it("puts an incident on hold through TicketExtras with the reason and the date", async () => {
    const w = world([incident(7)]);
    await w.svc.transition("7", { action: "hold", pendingReason: "Vendor", nextActionDate: "2026-11-02" });
    assert.deepEqual(w.holds, [{ id: "7", reason: "Vendor", nextActionDate: "2026-11-02" }]);
  });

  it("refuses a hold without a next-action date", async () => {
    const w = world([incident(7)]);
    await assert.rejects(w.svc.transition("7", { action: "hold", pendingReason: "Vendor" }), /next-action date/);
    assert.equal(w.holds.length, 0);
  });

  it("filters the list to overdue holds and to major incidents", async () => {
    const w = world([incident(7)]);
    await w.svc.list({ page: 1, limit: 25, overdue: true, major: true });
    assert.equal(
      w.lists[0],
      "SELECT Incident WHERE major_incident = 'yes' AND status = 'pending' AND next_action_date < '2026-10-27'",
    );
  });

  it("answers an empty page for those filters on an iTop without the extension", async () => {
    const w = world([incident(7)], { available: false });
    const result = await w.svc.list({ page: 1, limit: 25, major: true });
    assert.equal(result.total, 0);
    assert.equal(w.lists.length, 0);
  });

  it("accepts the hold fields and the list flags in the schemas", () => {
    const parsed = transitionSchema.parse({ action: "hold", pendingReason: "x", nextActionDate: "2026-11-02" });
    assert.equal(parsed.nextActionDate, "2026-11-02");
    assert.throws(() => transitionSchema.parse({ action: "hold", nextActionDate: "02/11/2026" }));
    const query = incidentListQuerySchema.parse({ major: "true", overdue: "0" });
    assert.equal(query.major, true);
    assert.equal(query.overdue, undefined);
  });
});

describe("IncidentsService: major incidents", () => {
  it("links children by setting iTop's parent_incident_id, and lists them", async () => {
    const w = world([incident(1), incident(2), incident(3)], { major: new Set(["1"]) });
    const detail = await w.svc.linkChildren("1", ["2", "3"]);
    assert.deepEqual(w.writes.map((x) => [x.id, x.fields["parent_incident_id"]]), [[2, 1], [3, 1]]);
    assert.deepEqual(detail.childIncidents.map((c) => c.ref), ["I-000002", "I-000003"]);
    assert.equal(detail.major, true);
  });

  it("refuses to link an incident to itself or to its own child's parent", async () => {
    const w = world([incident(1, { parent_incident_id: "2" }), incident(2)]);
    await assert.rejects(w.svc.linkChildren("1", ["1"]), /itself/);
    await assert.rejects(w.svc.linkChildren("1", ["2"]), /parent/);
    await assert.rejects(w.svc.linkChildren("1", ["9"]), /not found/);
    assert.equal(w.writes.length, 0);
  });

  it("unlinks a child by clearing its parent", async () => {
    const w = world([incident(1), incident(2, { parent_incident_id: "1" })]);
    const detail = await w.svc.unlinkChild("1", "2");
    assert.deepEqual(w.writes, [{ id: 2, fields: { parent_incident_id: 0 } }]);
    assert.equal(detail.childIncidents.length, 0);
  });

  it("posts a stakeholder update on the log, the open children and to the callers by email", async () => {
    const w = world(
      [
        incident(1, { caller_id: "50" }),
        incident(2, { parent_incident_id: "1", caller_id: "51" }),
        incident(3, { parent_incident_id: "1", caller_id: "51", status: "closed" }),
      ],
      { major: new Set(["1"]) },
    );
    const result = await w.svc.postStakeholderUpdate("1", {
      message: "Failover done; monitoring.",
      postToChildren: true,
      notifyCallers: true,
      notifyEmails: ["Exec@Example.com"],
    });
    assert.deepEqual(
      w.writes.map((x) => [x.id, x.fields["public_log"]]),
      [
        [1, "Stakeholder update: Failover done; monitoring."],
        [2, "I-000001 Stakeholder update: Failover done; monitoring."],
      ],
    );
    assert.equal(result.postedTo, 1);
    assert.deepEqual(result.notified.sort(), ["ana@example.com", "ben@example.com", "exec@example.com"]);
    // One email per address, each threaded on the ref.
    assert.equal(w.sent.length, 3);
    assert.ok(w.sent.every((m) => m.subject.startsWith("[I-000001] Update:")));
  });

  it("refuses a stakeholder update on an incident that is not major", async () => {
    const w = world([incident(1)]);
    await assert.rejects(w.svc.postStakeholderUpdate("1", { message: "hi" }), /not a major incident/);
    assert.equal(w.writes.length, 0);
  });

  it("escapes the message in the HTML email and keeps the subject on one line", () => {
    const mail = stakeholderMail("I-000001", "VPN\r\ndown", "<b>fixed</b> & done");
    assert.equal(mail.subject, "[I-000001] Update: VPN down");
    assert.match(mail.html, /&lt;b&gt;fixed&lt;\/b&gt; &amp; done/);
  });
});
