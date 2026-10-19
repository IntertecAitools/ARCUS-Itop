import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import { incidentListQuerySchema } from "../src/modules/incidents/incidents.schemas.js";
import type { Navigation } from "../src/platform/navigation/navigation.service.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
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

function objectsStub(rows: Record<string, ReturnType<typeof ticket>[]>, totals: Record<string, number> = {}) {
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
      ["Incident", "Problem", "UserRequest"],
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
