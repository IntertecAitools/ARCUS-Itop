import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IncidentsService } from "../src/modules/incidents/index.js";
import { incidentListQuerySchema } from "../src/modules/incidents/incidents.schemas.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";

/** Captures the OQL the service builds without touching the network. */
function stubObjects(items: unknown[] = []) {
  const calls: Array<{ className: string; query: Record<string, unknown> }> = [];
  const objects = {
    list: async (className: string, query: Record<string, unknown>) => {
      calls.push({ className, query });
      return {
        items,
        page: Number(query.page) || 1,
        limit: Number(query.limit) || 25,
        total: items.length,
        pages: 1,
        hasMore: false,
        sortedInBff: false,
      };
    },
  } as unknown as ObjectsService;
  return { objects, calls };
}

const baseQuery = { page: 1, limit: 25 };

describe("IncidentsService.list OQL", () => {
  it("selects every incident when no filter is given", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list(baseQuery);
    assert.equal(calls[0]?.query.oql, "SELECT Incident WHERE 1=1");
  });

  it("expands one of our statuses into every iTop state behind it", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({ ...baseQuery, status: ["open"] });
    // "open" hides three iTop states; collapsing it to one would silently drop
    // every escalated incident from the queue.
    assert.equal(
      calls[0]?.query.oql,
      "SELECT Incident WHERE status IN ('assigned','escalated_tto','escalated_ttr')",
    );
  });

  it("de-duplicates iTop states shared by two of our statuses", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({
      ...baseQuery,
      status: ["open", "in_progress"],
    });
    const oql = String(calls[0]?.query.oql);
    assert.equal(oql.match(/'assigned'/g)?.length, 1);
  });

  it("maps our priority names onto iTop's numbers", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({ ...baseQuery, priority: ["critical", "low"] });
    assert.equal(calls[0]?.query.oql, "SELECT Incident WHERE priority IN ('1','4')");
  });

  it("treats 'unassigned' as iTop's agent_id 0", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({ ...baseQuery, assignee: "unassigned" });
    assert.equal(calls[0]?.query.oql, "SELECT Incident WHERE agent_id = 0");
  });

  it("escapes a quote in the search term so it cannot break out of the literal", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({ ...baseQuery, q: "o'brien" });
    const oql = String(calls[0]?.query.oql);
    assert.ok(oql.includes("o\\'brien"), oql);
  });

  it("combines filters with AND", async () => {
    const { objects, calls } = stubObjects();
    await new IncidentsService(objects).list({
      ...baseQuery,
      status: ["resolved"],
      priority: ["high"],
    });
    assert.equal(
      calls[0]?.query.oql,
      "SELECT Incident WHERE status IN ('resolved') AND priority IN ('2')",
    );
  });

  it("returns an empty page without querying when a filter matches nothing", async () => {
    const { objects, calls } = stubObjects();
    // An unsatisfiable filter must not fall through to a bare SELECT, which
    // would return every incident -- the opposite of what was asked for.
    const result = await new IncidentsService(objects).list({
      ...baseQuery,
      assignee: "not-a-number",
    });
    assert.equal(calls.length, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  });
});

describe("IncidentsService mapping", () => {
  it("translates iTop's vocabulary into ours", async () => {
    const { objects } = stubObjects([
      {
        class: "Incident",
        id: 7,
        label: "I-7",
        fields: {
          ref: "I-007",
          title: "VPN down",
          status: "escalated_ttr",
          priority: "1",
          agent_id: "3",
          agent_name: "Ravi",
          start_date: "2026-10-06 09:15:00",
        },
      },
    ]);

    const { items } = await new IncidentsService(objects).list(baseQuery);
    assert.deepEqual(items[0], {
      id: "7",
      ref: "I-007",
      summary: "VPN down",
      status: "open",
      priority: "critical",
      assignee: { id: "3", name: "Ravi" },
      createdAt: "2026-10-06 09:15:00",
    });
  });

  it("omits the assignee when iTop reports agent_id 0", async () => {
    const { objects } = stubObjects([
      {
        class: "Incident",
        id: 8,
        label: "I-8",
        fields: { ref: "I-008", status: "new", priority: "3", agent_id: "0", agent_name: "" },
      },
    ]);
    const { items } = await new IncidentsService(objects).list(baseQuery);
    assert.equal(items[0]?.assignee, undefined);
  });

  it("raises 404 for an id that does not exist", async () => {
    const { objects } = stubObjects([]);
    await assert.rejects(() => new IncidentsService(objects).get("999"), /not been found|not found/i);
  });
});

describe("incidentListQuerySchema", () => {
  it("accepts a comma-separated list", () => {
    const parsed = incidentListQuerySchema.parse({ status: "open,resolved" });
    assert.deepEqual(parsed.status, ["open", "resolved"]);
  });

  it("accepts a repeated query param", () => {
    const parsed = incidentListQuerySchema.parse({ status: ["open", "pending"] });
    assert.deepEqual(parsed.status, ["open", "pending"]);
  });

  it("defaults page and limit", () => {
    const parsed = incidentListQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 25);
  });

  it("rejects a status outside our vocabulary", () => {
    assert.throws(() => incidentListQuerySchema.parse({ status: "assigned" }));
  });

  it("rejects an assignee that is neither a number nor 'unassigned'", () => {
    assert.throws(() => incidentListQuerySchema.parse({ assignee: "me; DROP" }));
  });
});
