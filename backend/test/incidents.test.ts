import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IncidentsService } from "../src/modules/incidents/index.js";
import {
  createIncidentSchema,
  incidentListQuerySchema,
  transitionSchema,
  updateIncidentSchema,
} from "../src/modules/incidents/incidents.schemas.js";
import type { CmdbSchema } from "../src/schema/load.js";
import type { DefaultOrganization } from "../src/shared/default-organization.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";

/** The real Incident lifecycle, lifted from the compiled datamodel. */
const LIFECYCLE = {
  attribute: "status",
  states: {
    new: ["ev_assign", "ev_timeout", "ev_autoresolve"],
    assigned: ["ev_pending", "ev_resolve", "ev_reassign", "ev_timeout", "ev_autoresolve"],
    escalated_tto: ["ev_assign", "ev_autoresolve"],
    escalated_ttr: ["ev_pending", "ev_resolve", "ev_reassign", "ev_autoresolve"],
    pending: ["ev_assign", "ev_autoresolve"],
    resolved: ["ev_close", "ev_reopen"],
    closed: [],
  },
};

const schemaStub = {
  get: () => ({ lifecycle: LIFECYCLE }),
} as unknown as CmdbSchema;

function row(fields: Record<string, unknown> = {}) {
  return {
    class: "Incident",
    id: 7,
    label: "I-7",
    fields: {
      ref: "I-000007",
      title: "VPN down",
      status: "assigned",
      priority: "1",
      agent_id: "3",
      agent_name: "Ravi",
      start_date: "2026-10-06 09:15:00",
      ...fields,
    },
  };
}

/** Captures what the service sends without touching the network. */
function stub(items: unknown[] = [], overrides: Record<string, unknown> = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const objects = {
    list: async (className: string, query: Record<string, unknown>) => {
      calls.push({ op: "list", args: [className, query] });
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
    create: async (...args: unknown[]) => {
      calls.push({ op: "create", args });
      return { object: items[0] ?? row(), rejected: [] };
    },
    update: async (...args: unknown[]) => {
      calls.push({ op: "update", args });
      return { object: items[0] ?? row(), rejected: [] };
    },
    applyStimulus: async (...args: unknown[]) => {
      calls.push({ op: "applyStimulus", args });
      return items[0] ?? row();
    },
    ...overrides,
  } as unknown as ObjectsService;
    // Resolves instantly so create() does not depend on a live lookup.
  const defaultOrg = { resolve: async () => "1" } as unknown as DefaultOrganization;
  return { objects, calls, svc: new IncidentsService(objects, schemaStub, defaultOrg) };
}

const baseQuery = { page: 1, limit: 25 };

describe("IncidentsService.list OQL", () => {
  it("selects every incident when no filter is given", async () => {
    const { svc, calls } = stub();
    await svc.list(baseQuery);
    assert.equal((calls[0]?.args[1] as Record<string, unknown>).oql, "SELECT Incident WHERE 1=1");
  });

  it("expands one of our statuses into every iTop state behind it", async () => {
    const { svc, calls } = stub();
    await svc.list({ ...baseQuery, status: ["open"] });
    // "open" hides three iTop states; collapsing it to one would silently drop
    // every escalated incident from the queue.
    assert.equal(
      (calls[0]?.args[1] as Record<string, unknown>).oql,
      "SELECT Incident WHERE status IN ('assigned','escalated_tto','escalated_ttr')",
    );
  });

  it("de-duplicates iTop states shared by two of our statuses", async () => {
    const { svc, calls } = stub();
    await svc.list({ ...baseQuery, status: ["open", "in_progress"] });
    const oql = String((calls[0]?.args[1] as Record<string, unknown>).oql);
    assert.equal(oql.match(/'assigned'/g)?.length, 1);
  });

  it("maps our priority names onto iTop's numbers", async () => {
    const { svc, calls } = stub();
    await svc.list({ ...baseQuery, priority: ["critical", "low"] });
    assert.equal(
      (calls[0]?.args[1] as Record<string, unknown>).oql,
      "SELECT Incident WHERE priority IN ('1','4')",
    );
  });

  it("treats 'unassigned' as iTop's agent_id 0", async () => {
    const { svc, calls } = stub();
    await svc.list({ ...baseQuery, assignee: "unassigned" });
    assert.equal(
      (calls[0]?.args[1] as Record<string, unknown>).oql,
      "SELECT Incident WHERE agent_id = 0",
    );
  });

  it("escapes a quote in the search term so it cannot break out of the literal", async () => {
    const { svc, calls } = stub();
    await svc.list({ ...baseQuery, q: "o'brien" });
    assert.ok(String((calls[0]?.args[1] as Record<string, unknown>).oql).includes("o\\'brien"));
  });

  it("returns an empty page without querying when a filter matches nothing", async () => {
    const { svc, calls } = stub();
    // An unsatisfiable filter must not fall through to a bare SELECT, which
    // would return every incident -- the opposite of what was asked for.
    const result = await svc.list({ ...baseQuery, assignee: "not-a-number" });
    assert.equal(calls.length, 0);
    assert.deepEqual(result.items, []);
  });
});

describe("IncidentsService mapping", () => {
  it("translates iTop's vocabulary into ours", async () => {
    const { svc } = stub([row({ status: "escalated_ttr" })]);
    const { items } = await svc.list(baseQuery);
    assert.deepEqual(items[0], {
      id: "7",
      ref: "I-000007",
      summary: "VPN down",
      status: "open",
      priority: "critical",
      assignee: { id: "3", name: "Ravi" },
      createdAt: "2026-10-06 09:15:00",
    });
  });

  it("omits the assignee when iTop reports agent_id 0", async () => {
    const { svc } = stub([row({ agent_id: "0", agent_name: "" })]);
    const { items } = await svc.list(baseQuery);
    assert.equal(items[0]?.assignee, undefined);
  });

  it("raises 404 for an id that does not exist", async () => {
    const { svc } = stub([]);
    await assert.rejects(() => svc.get("999"), /not found/i);
  });

  it("decodes impact and urgency out of iTop's numbers", async () => {
    const { svc } = stub([row({ impact: "1", urgency: "2" })]);
    const detail = await svc.get("7");
    assert.equal(detail.impact, "critical");
    assert.equal(detail.urgency, "high");
  });

  it("normalises a CaseLog object into entries", async () => {
    const { svc } = stub([
      row({
        public_log: {
          entries: [{ date: "2026-10-06", user_login: "admin", message: "Looking into it" }],
        },
      }),
    ]);
    const detail = await svc.get("7");
    assert.deepEqual(detail.log, [
      { date: "2026-10-06", author: "admin", message: "Looking into it" },
    ]);
  });

  it("keeps a plain-string CaseLog rather than dropping it", async () => {
    const { svc } = stub([row({ public_log: "a rendered log" })]);
    const detail = await svc.get("7");
    assert.equal(detail.log.length, 1);
    assert.equal(detail.log[0]?.message, "a rendered log");
  });
});

describe("available actions", () => {
  const actionsFor = async (status: string) => {
    const { svc } = stub([row({ status })]);
    return (await svc.get("7")).availableActions;
  };

  it("offers resolve and reassign on an assigned incident", async () => {
    const actions = await actionsFor("assigned");
    assert.deepEqual(actions.sort(), ["hold", "reassign", "resolve"]);
  });

  it("offers only assign on a new incident", async () => {
    assert.deepEqual(await actionsFor("new"), ["assign"]);
  });

  it("offers close and reopen once resolved", async () => {
    assert.deepEqual((await actionsFor("resolved")).sort(), ["close", "reopen"]);
  });

  it("offers nothing on a closed incident", async () => {
    assert.deepEqual(await actionsFor("closed"), []);
  });

  it("never exposes iTop's automatic stimuli as user actions", async () => {
    // ev_timeout and ev_autoresolve are fired by iTop's background tasks;
    // surfacing them would let someone fake an SLA timeout.
    const actions = await actionsFor("assigned");
    assert.ok(!actions.some((a) => String(a).includes("timeout")));
    assert.ok(!actions.some((a) => String(a).includes("auto")));
  });
});

describe("IncidentsService.transition", () => {
  it("sends iTop's stimulus for our action name", async () => {
    const { svc, calls } = stub([row({ status: "assigned" })]);
    await svc.transition("7", { action: "resolve", solution: "Rebooted the gateway" });
    const call = calls.find((c) => c.op === "applyStimulus");
    assert.equal(call?.args[2], "ev_resolve");
    assert.deepEqual(call?.args[3], { solution: "Rebooted the gateway" });
  });

  it("rejects an action that is illegal in the current state", async () => {
    const { svc } = stub([row({ status: "closed" })]);
    await assert.rejects(
      () => svc.transition("7", { action: "resolve", solution: "x" }),
      /not available/i,
    );
  });

  it("rejects a transition that is missing its required field", async () => {
    const { svc } = stub([row({ status: "assigned" })]);
    // resolve without a solution would be accepted by iTop and leave the
    // incident resolved with no explanation.
    await assert.rejects(() => svc.transition("7", { action: "resolve" }), /requires solution/i);
  });

  it("does not call iTop at all when the action is illegal", async () => {
    const { svc, calls } = stub([row({ status: "closed" })]);
    await assert.rejects(() => svc.transition("7", { action: "close" }));
    assert.equal(calls.filter((c) => c.op === "applyStimulus").length, 0);
  });
});

describe("IncidentsService.update", () => {
  it("maps our field names onto iTop's", async () => {
    const { svc, calls } = stub([row()]);
    await svc.update("7", { title: "New title", urgency: "2", agentId: "5" });
    const fields = calls.find((c) => c.op === "update")?.args[2] as Record<string, unknown>;
    assert.deepEqual(fields, { title: "New title", urgency: "2", agent_id: 5 });
  });

  it("clears a link when the id is null, rather than ignoring it", async () => {
    const { svc, calls } = stub([row()]);
    await svc.update("7", { agentId: null });
    const fields = calls.find((c) => c.op === "update")?.args[2] as Record<string, unknown>;
    // 0 is iTop's "no link". Omitting the key would mean "leave unchanged",
    // so the two cases must stay distinct.
    assert.deepEqual(fields, { agent_id: 0 });
  });

  it("rejects an empty patch instead of issuing a no-op write", async () => {
    const { svc } = stub([row()]);
    await assert.rejects(() => svc.update("7", {}), /no changes/i);
  });
});

describe("IncidentsService.create", () => {
  it("defaults urgency and impact rather than leaving them to chance", async () => {
    const { svc, calls } = stub([row()]);
    await svc.create({ title: "T", description: "D", organizationId: "1" });
    const fields = calls.find((c) => c.op === "create")?.args[1] as Record<string, unknown>;
    assert.equal(fields.urgency, "3");
    assert.equal(fields.impact, "2");
    assert.equal(fields.org_id, 1);
  });

  it("sends a placeholder priority, which iTop requires but then recomputes", async () => {
    // iTop flags priority NOT NULL so create fails without it, yet recomputes
    // it from urgency x impact and discards what was sent. Omitting it breaks
    // create; honouring a caller-supplied value would be a lie.
    const { svc, calls } = stub([row()]);
    await svc.create({ title: "T", description: "D", organizationId: "1" });
    const fields = calls.find((c) => c.op === "create")?.args[1] as Record<string, unknown>;
    assert.equal(fields.priority, "3");
  });

  it("omits optional links rather than sending 0", async () => {
    const { svc, calls } = stub([row()]);
    await svc.create({ title: "T", description: "D", organizationId: "1" });
    const fields = calls.find((c) => c.op === "create")?.args[1] as Record<string, unknown>;
    assert.ok(!("agent_id" in fields));
    assert.ok(!("caller_id" in fields));
  });
});

describe("IncidentsService.formOptions", () => {
  it("still returns the static lists when a lookup class is missing", async () => {
    // A class the instance does not have must not take the whole form down.
    const { svc } = stub([], {
      list: async () => {
        throw new Error("Unknown class");
      },
    });
    const options = await svc.formOptions();
    assert.equal(options.priorities.length, 4);
    assert.deepEqual(options.organizations, []);
  });
});

describe("validation schemas", () => {
  it("accepts a comma-separated list", () => {
    assert.deepEqual(incidentListQuerySchema.parse({ status: "open,resolved" }).status, [
      "open",
      "resolved",
    ]);
  });

  it("accepts a repeated query param", () => {
    assert.deepEqual(incidentListQuerySchema.parse({ status: ["open", "pending"] }).status, [
      "open",
      "pending",
    ]);
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

  it("requires title, description and organisation on create", () => {
    assert.throws(() => createIncidentSchema.parse({ title: "only a title" }));
    assert.doesNotThrow(() =>
      createIncidentSchema.parse({ title: "T", description: "D", organizationId: "1" }),
    );
  });

  it("rejects a blank title made only of whitespace", () => {
    assert.throws(() =>
      createIncidentSchema.parse({ title: "   ", description: "D", organizationId: "1" }),
    );
  });

  it("rejects an empty update patch", () => {
    assert.throws(() => updateIncidentSchema.parse({}));
  });

  it("drops priority from write payloads, since iTop derives it", () => {
    const created = createIncidentSchema.parse({
      title: "T",
      description: "D",
      organizationId: "1",
      priority: "critical",
    });
    assert.ok(!("priority" in created));
  });

  it("rejects an unknown transition action", () => {
    assert.throws(() => transitionSchema.parse({ action: "ev_resolve" }));
    assert.doesNotThrow(() => transitionSchema.parse({ action: "resolve", solution: "x" }));
  });
});

describe("transitions that carry no fields", () => {
  it("applies a stimulus with an empty field map", async () => {
    // ev_close and ev_reopen carry no data. If an empty map were treated as an
    // empty update, those transitions would be impossible to apply at all.
    const { svc, calls } = stub([row({ status: "resolved" })]);
    await svc.transition("7", { action: "close" });
    const call = calls.find((c) => c.op === "applyStimulus");
    assert.equal(call?.args[2], "ev_close");
    assert.deepEqual(call?.args[3], {});
  });
});
