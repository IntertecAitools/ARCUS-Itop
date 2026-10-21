import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import { incidentListQuerySchema } from "../src/modules/incidents/incidents.schemas.js";
import type { Navigation } from "../src/platform/navigation/navigation.service.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import type { CmdbSchema } from "../src/schema/load.js";
import type { CurrentContact } from "../src/shared/current-contact.js";

/** iTop's own "assigned to me" menus, as cmdb-navigation.json carries them. */
const VIEWS: Record<string, { class: string; oql: string; needsContact: boolean }> = {
  "Incident:MyIncidents": {
    class: "Incident",
    oql: 'SELECT Incident WHERE agent_id = :current_contact_id AND status NOT IN ("closed","resolved")',
    needsContact: true,
  },
  "UserRequest:MyRequests": {
    class: "UserRequest",
    oql: 'SELECT UserRequest WHERE agent_id = :current_contact_id AND status NOT IN ("closed","resolved")',
    needsContact: true,
  },
  "Problem:MyProblems": {
    class: "Problem",
    oql: 'SELECT Problem WHERE agent_id = :current_contact_id AND status NOT IN ("closed", "resolved")',
    needsContact: true,
  },
  // iTop names this one without a class prefix.
  MyChanges: {
    class: "Change",
    oql: 'SELECT Change WHERE agent_id = :current_contact_id AND status NOT IN ("closed", "resolved")',
    needsContact: true,
  },
};

function navigation(views = VIEWS): Navigation {
  return {
    resolveView(id: string) {
      const view = views[id];
      if (!view) throw new Error(`No view ${id}`);
      return view;
    },
  } as unknown as Navigation;
}

const contact = (id: string | null) =>
  ({ tryResolve: async () => id }) as unknown as CurrentContact;

function ticket(className: string, id: number, priority: string) {
  return {
    class: className,
    id,
    label: `${className}-${id}`,
    fields: { ref: `X-${id}`, title: `t${id}`, status: "assigned", priority, agent_id: "1", agent_name: "Me", start_date: "" },
  };
}

type Row = { class: string; id: number; label: string; fields: Record<string, unknown> };

function objectsStub(rows: Record<string, Row[]>, totals: Record<string, number> = {}) {
  const calls: Array<{ className: string; oql: string }> = [];
  const objects = {
    async list(className: string, query: { oql: string }) {
      calls.push({ className, oql: query.oql });
      const items = rows[className] ?? [];
      return { items, total: totals[className] ?? items.length };
    },
  } as unknown as ObjectsService;
  return { objects, calls };
}

describe("DashboardService.myAssignments", () => {
  it("fills each queue from iTop's own view, bound to the caller's contact", async () => {
    const { objects, calls } = objectsStub(
      {
        Incident: [ticket("Incident", 3, "3"), ticket("Incident", 5, "1"), ticket("Incident", 4, "3")],
        UserRequest: [ticket("UserRequest", 8, "2")],
      },
      { Incident: 120 },
    );
    const result = await new DashboardService(objects, navigation(), contact("42")).myAssignments();

    assert.deepEqual(
      calls.map((c) => c.className).sort(),
      ["Change", "Incident", "Problem", "UserRequest"],
    );
    for (const call of calls) {
      assert.match(call.oql, /agent_id = 42 AND/);
      assert.doesNotMatch(call.oql, /:current_contact_id/);
    }
    // Most urgent first, then newest.
    assert.deepEqual(result.incidents.items.map((t) => t.id), ["5", "4", "3"]);
    // The real total, not the number of rows sent.
    assert.equal(result.incidents.total, 120);
    assert.equal(result.requests.items[0]?.priority, "high");
    assert.deepEqual(result.problems, { items: [], total: 0 });
  });

  it("is empty, without asking iTop, when the account has no linked Person", async () => {
    const { objects, calls } = objectsStub({ Incident: [ticket("Incident", 1, "1")] });
    const result = await new DashboardService(objects, navigation(), contact(null)).myAssignments();
    assert.equal(calls.length, 0);
    assert.equal(result.incidents.total, 0);
  });

  it("leaves a queue empty when this iTop has no such view", async () => {
    const { "Problem:MyProblems": _missing, ...withoutProblems } = VIEWS;
    const { objects, calls } = objectsStub({ Incident: [ticket("Incident", 1, "1")] });
    const result = await new DashboardService(objects, navigation(withoutProblems), contact("7")).myAssignments();
    assert.equal(calls.some((c) => c.className === "Problem"), false);
    assert.equal(result.incidents.total, 1);
    assert.deepEqual(result.problems, { items: [], total: 0 });
  });
});

describe("incident list ?assignee", () => {
  it("accepts 'me' and rejects anything else that is not an id", () => {
    assert.equal(incidentListQuerySchema.parse({ assignee: "me" }).assignee, "me");
    assert.throws(() => incidentListQuerySchema.parse({ assignee: "someone" }));
  });
});

describe("DashboardService.myAssignments when iTop refuses a queue", () => {
  it("empties that queue and keeps the others", async () => {
    const objects = {
      async list(className: string) {
        if (className === "Problem") throw new Error("not allowed");
        return { items: [ticket(className, 1, "2")], total: 1 };
      },
    } as unknown as ObjectsService;
    const result = await new DashboardService(objects, navigation(), contact("1")).myAssignments();
    assert.deepEqual(result.problems, { items: [], total: 0 });
    assert.equal(result.incidents.total, 1);
    assert.equal(result.requests.total, 1);
  });
});

describe("DashboardService.myAssignments changes", () => {
  const change = (id: number, className: string, status: string, start: string) => ({
    class: className,
    id,
    label: `C-${id}`,
    fields: { ref: `C-${id}`, title: `change ${id}`, status, start_date: start, finalclass: className },
  });
  // iTop's own labels, as cmdb-schema.json carries them per class.
  const schema = {
    get(name: string) {
      const values: Record<string, Record<string, Record<string, string>>> = {
        Change: { status: { plannedscheduled: "Planned and scheduled", approved: "Approved" } },
        NormalChange: { status: { plannedscheduled: "Planned and scheduled", approved: "Approved" } },
      };
      return values[name] ? { labels: { values: values[name] } } : undefined;
    },
  } as unknown as CmdbSchema;

  it("lists the caller's changes with iTop's status labels, soonest first", async () => {
    const { objects, calls } = objectsStub(
      {
        Change: [
          change(4, "NormalChange", "approved", ""),
          change(2, "NormalChange", "plannedscheduled", "2026-10-30T09:00:00Z"),
          change(3, "EmergencyChange", "plannedscheduled", "2026-10-22T18:00:00Z"),
        ],
      },
      { Change: 3 },
    );
    const result = await new DashboardService(objects, navigation(), contact("42"), schema).myAssignments();
    const call = calls.find((c) => c.className === "Change");
    assert.match(call!.oql, /SELECT Change WHERE agent_id = 42 AND/);
    assert.equal(result.changes.total, 3);
    assert.deepEqual(
      result.changes.items.map((c) => [c.id, c.class, c.status, c.statusLabel]),
      [
        // EmergencyChange has no labels of its own here: Change's are used.
        ["3", "EmergencyChange", "plannedscheduled", "Planned and scheduled"],
        ["2", "NormalChange", "plannedscheduled", "Planned and scheduled"],
        ["4", "NormalChange", "approved", "Approved"],
      ],
    );
  });

  it("is empty when this iTop has no MyChanges view", async () => {
    const { MyChanges: _missing, ...withoutChanges } = VIEWS;
    const { objects } = objectsStub({ Change: [change(1, "Change", "new", "")] });
    const result = await new DashboardService(objects, navigation(withoutChanges), contact("7"), schema).myAssignments();
    assert.deepEqual(result.changes, { items: [], total: 0 });
  });
});
