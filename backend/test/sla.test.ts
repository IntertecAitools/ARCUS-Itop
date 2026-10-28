import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { SlaService, type SlaMetric, type SlaMetricState } from "../src/modules/sla/index.js";
import {
  buildGoals,
  byPriority,
  groupBy,
  metricState,
  sltSeconds,
  ticketState,
  toSlaTicket,
  type MetricInput,
} from "../src/modules/sla/sla-state.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

const TZ = "Europe/Paris";
const NOW = Date.parse("2026-10-27T12:00:00Z");
const HOUR = 3_600_000;

/* ------------------------------------------------------------------------- *
 * Targets: the SLT iTop would pick
 * ------------------------------------------------------------------------- */

describe("SLT targets", () => {
  it("converts units to seconds", () => {
    assert.equal(sltSeconds(2, "hours"), 7200);
    assert.equal(sltSeconds(15, "minutes"), 900);
    assert.equal(sltSeconds(1, "days"), 86_400);
  });

  it("picks the shortest SLT among the contracts of the ticket's organisation for its service", () => {
    const goals = buildGoals(
      [
        { id: "10", orgId: "3" },
        { id: "11", orgId: "3" },
        { id: "12", orgId: "4" },
      ],
      [
        { contractId: "10", serviceId: "7", slaId: "100" },
        { contractId: "11", serviceId: "7", slaId: "101" },
        { contractId: "12", serviceId: "7", slaId: "102" },
      ],
      [
        { slaId: "100", metric: "tto", requestType: "incident", priority: "1", value: 2, unit: "hours" },
        { slaId: "101", metric: "tto", requestType: "incident", priority: "1", value: 30, unit: "minutes" },
        { slaId: "101", metric: "ttr", requestType: "incident", priority: "1", value: 8, unit: "hours" },
        { slaId: "102", metric: "tto", requestType: "incident", priority: "1", value: 5, unit: "minutes" },
      ],
    );
    assert.equal(goals("3", "7", "incident", "1", "tto"), 1800);
    assert.equal(goals("3", "7", "incident", "1", "ttr"), 8 * 3600);
    assert.equal(goals("4", "7", "incident", "1", "tto"), 300);
    assert.equal(goals("3", "7", "incident", "2", "tto"), null, "another priority");
    assert.equal(goals("3", "8", "incident", "1", "tto"), null, "another service");
    assert.equal(goals("3", "7", "service_request", "1", "tto"), null, "another request type");
  });
});

/* ------------------------------------------------------------------------- *
 * One stopwatch
 * ------------------------------------------------------------------------- */

const base: MetricInput = {
  metric: "ttr",
  className: "Incident",
  status: "assigned",
  startMs: NOW - 2 * HOUR,
  deadlineMs: null,
  passed: false,
  timeSpent: 0,
  goal: 4 * 3600,
  nowMs: NOW,
};

describe("stopwatch state", () => {
  it("is within target while under 75% of the target is used", () => {
    const m = metricState({ ...base, deadlineMs: NOW + 2 * HOUR });
    assert.equal(m.state, "within");
    assert.equal(m.percentUsed, 50);
    assert.equal(m.deadline, new Date(NOW + 2 * HOUR).toISOString());
  });

  it("is at risk from 75% of the target", () => {
    assert.equal(metricState({ ...base, deadlineMs: NOW + HOUR }).state, "at_risk");
    assert.equal(metricState({ ...base, deadlineMs: NOW + HOUR }).percentUsed, 75);
  });

  it("is breached once iTop flags it, or once the deadline is behind us", () => {
    assert.equal(metricState({ ...base, deadlineMs: NOW + HOUR, passed: true }).state, "breached");
    const late = metricState({ ...base, deadlineMs: NOW - HOUR });
    assert.equal(late.state, "breached");
    assert.equal(late.percentUsed, 125);
    const stopped = metricState({ ...base, passed: true, timeSpent: 5 * 3600 });
    assert.equal(stopped.state, "breached");
  });

  it("counts remaining time against the target, so a paused-and-resumed TTR is right", () => {
    // 4 h target, 3 h spent before a pause: the deadline moved, 1 h is left.
    const m = metricState({ ...base, startMs: NOW - 2 * 24 * HOUR, deadlineMs: NOW + HOUR });
    assert.equal(m.percentUsed, 75);
  });

  it("falls back to the wall-clock window when no SLT matches a running deadline", () => {
    const m = metricState({ ...base, goal: null, deadlineMs: NOW + 2 * HOUR });
    assert.equal(m.state, "within");
    assert.equal(m.percentUsed, 50);
  });

  it("is paused while stopped mid-way, with the share used so far", () => {
    const m = metricState({ ...base, status: "pending", timeSpent: 3.5 * 3600 });
    assert.equal(m.state, "paused");
    assert.equal(m.percentUsed, 88);
    assert.equal(m.deadline, null);
  });

  it("calls a stopped TTO met once the ticket left the TTO states", () => {
    assert.equal(metricState({ ...base, metric: "tto", status: "assigned", timeSpent: 600 }).state, "met");
    assert.equal(metricState({ ...base, metric: "tto", status: "new" }).state, "paused");
    assert.equal(
      metricState({ ...base, metric: "tto", className: "UserRequest", status: "approved" }).state,
      "paused",
    );
  });

  it("is none without an SLT", () => {
    assert.equal(metricState({ ...base, goal: null }).state, "none");
  });
});

describe("ticket state", () => {
  const m = (state: SlaMetricState, percentUsed: number | null = null): SlaMetric => ({
    state,
    percentUsed,
    deadline: null,
    goalSeconds: 1,
  });

  it("is the worse of TTO and TTR", () => {
    assert.equal(ticketState(m("met"), m("within")), "within");
    assert.equal(ticketState(m("met"), m("at_risk")), "at_risk");
    assert.equal(ticketState(m("breached"), m("within")), "breached");
    assert.equal(ticketState(m("none"), m("none")), "none");
    assert.equal(ticketState(m("none"), m("paused", 80)), "at_risk");
    assert.equal(ticketState(m("none"), m("paused", 20)), "within");
  });
});

/* ------------------------------------------------------------------------- *
 * Rows from iTop
 * ------------------------------------------------------------------------- */

const goals = buildGoals(
  [{ id: "10", orgId: "3" }],
  [{ contractId: "10", serviceId: "7", slaId: "100" }],
  [
    { slaId: "100", metric: "tto", requestType: "incident", priority: "2", value: 1, unit: "hours" },
    { slaId: "100", metric: "ttr", requestType: "incident", priority: "2", value: 4, unit: "hours" },
    { slaId: "100", metric: "ttr", requestType: "service_request", priority: "2", value: 8, unit: "hours" },
  ],
);

function incident(id: number, fields: Record<string, unknown>) {
  return {
    id,
    fields: {
      ref: `I-${id}`,
      title: `Incident ${id}`,
      status: "assigned",
      priority: "2",
      org_id: "3",
      org_name: "Acme",
      team_id: "5",
      team_name: "Service desk",
      agent_name: "Ann Agent",
      service_id: "7",
      start_date: "2026-10-27 11:00:00",
      tto_escalation_deadline: "",
      ttr_escalation_deadline: "",
      sla_tto_passed: "no",
      sla_ttr_passed: "no",
      tto_time_spent: 300,
      ttr_time_spent: 0,
      ...fields,
    },
  };
}

describe("tickets from iTop rows", () => {
  it("reads iTop's local deadlines in the iTop time zone", () => {
    // 15:00 Paris (UTC+1 on 27 October) is 14:00Z: 2 h left of 4 h.
    const t = toSlaTicket(
      { className: "Incident", ...incident(1, { ttr_escalation_deadline: "2026-10-27 15:00:00" }) },
      goals,
      NOW,
      TZ,
    );
    assert.equal(t.tto.state, "met");
    assert.equal(t.ttr.state, "within");
    assert.equal(t.ttr.percentUsed, 50);
    assert.equal(t.ttr.deadline, "2026-10-27T14:00:00.000Z");
    assert.equal(t.state, "within");
    assert.equal(t.teamName, "Service desk");
    assert.equal(t.startDate, "2026-10-27T10:00:00.000Z");
  });

  it("takes ISO dates as the objects layer may return them", () => {
    const t = toSlaTicket(
      { className: "Incident", ...incident(1, { ttr_escalation_deadline: "2026-10-27T12:30:00.000Z" }) },
      goals,
      NOW,
      TZ,
    );
    assert.equal(t.ttr.state, "at_risk");
  });

  it("treats team 0 as no team and a ticket without SLT as none", () => {
    const t = toSlaTicket({ className: "Incident", ...incident(2, { team_id: "0", service_id: "99" }) }, goals, NOW, TZ);
    assert.equal(t.teamId, "");
    assert.equal(t.teamName, "");
    assert.equal(t.state, "none");
  });
});

describe("grouping", () => {
  const tickets = [
    toSlaTicket({ className: "Incident", ...incident(1, { sla_ttr_passed: "yes" }) }, goals, NOW, TZ),
    toSlaTicket({ className: "Incident", ...incident(2, { team_id: "6", team_name: "Network" }) }, goals, NOW, TZ),
    toSlaTicket({ className: "Incident", ...incident(3, { priority: "1" }) }, goals, NOW, TZ),
  ];

  it("counts states per group, worst group first", () => {
    const teams = groupBy(tickets, (t) => t.teamId, (t) => t.teamName);
    assert.deepEqual(
      teams.map((g) => [g.label, g.breached, g.total]),
      [
        ["Service desk", 1, 2],
        ["Network", 0, 1],
      ],
    );
  });

  it("orders priorities critical first and names them", () => {
    assert.deepEqual(
      byPriority(tickets).map((g) => [g.key, g.label, g.total]),
      [
        ["1", "Critical", 1],
        ["2", "High", 2],
      ],
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The service, over a stubbed objects layer
 * ------------------------------------------------------------------------- */

function stub() {
  const calls: Array<{ className: string; query: { oql?: string; fields?: string } }> = [];
  const rows: Record<string, Array<{ id: number; fields: Record<string, unknown> }>> = {
    CustomerContract: [{ id: 10, fields: { org_id: "3" } }],
    lnkCustomerContractToService: [{ id: 1, fields: { customercontract_id: "10", service_id: "7", sla_id: "100" } }],
    lnkSLAToSLT: [
      {
        id: 1,
        fields: {
          sla_id: "100",
          slt_metric: "ttr",
          slt_request_type: "incident",
          slt_ticket_priority: "2",
          slt_value: "4",
          slt_value_unit: "hours",
        },
      },
    ],
    Incident: [
      incident(1, { ttr_escalation_deadline: "2026-10-27 15:00:00" }),
      incident(2, { ttr_escalation_deadline: "2026-10-27 13:30:00", team_id: "6", team_name: "Network" }),
      incident(3, { sla_ttr_passed: "yes", org_id: "4", org_name: "Globex" }),
    ],
    UserRequest: [incident(4, { ref: "R-4", team_id: "0" })],
  };
  const objects = {
    listAll: async (className: string, query: { oql?: string; fields?: string }) => {
      calls.push({ className, query });
      const items = (rows[className] ?? []).map((r) => ({ class: className, label: "", ...r }));
      return { items, total: items.length, truncated: false };
    },
  } as unknown as ObjectsService;
  return { service: new SlaService(objects, TZ, undefined, () => new Date(NOW)), calls };
}

describe("SlaService", () => {
  it("reads open incidents and requests only", async () => {
    const { service, calls } = stub();
    await service.dashboard("all");
    const incident = calls.find((c) => c.className === "Incident")!;
    assert.match(incident.query.oql!, /status NOT IN \('resolved','closed'\)$/);
    assert.match(incident.query.fields!, /sla_ttr_passed/);
    const request = calls.find((c) => c.className === "UserRequest")!;
    assert.match(request.query.oql!, /'rejected'/);
  });

  it("summarises by state, team, priority and customer", async () => {
    const { service } = stub();
    const d = await service.dashboard("all");
    assert.deepEqual(d.totals, { within: 1, atRisk: 1, breached: 1, none: 1, total: 4 });
    assert.equal(d.atRiskPercent, 75);
    assert.deepEqual(
      d.byTeam.map((g) => [g.key, g.label]),
      [
        ["5", "Service desk"],
        ["6", "Network"],
        ["", "No team"],
      ],
    );
    assert.deepEqual(
      d.byCustomer.map((g) => [g.label, g.total]),
      [
        ["Globex", 1],
        ["Acme", 3],
      ],
    );
  });

  it("asks only for incidents when told to", async () => {
    const { service, calls } = stub();
    const d = await service.dashboard("incident");
    assert.equal(d.totals.total, 3);
    assert.equal(calls.some((c) => c.className === "UserRequest"), false);
  });

  it("drills down to the tickets behind a count, most urgent first", async () => {
    const { service } = stub();
    let list = await service.tickets({ type: "all", state: "at_risk" });
    assert.deepEqual(list.items.map((t) => t.ref), ["I-2"]);
    list = await service.tickets({ type: "all", team: "5" });
    assert.deepEqual(list.items.map((t) => t.ref), ["I-3", "I-1"]);
    list = await service.tickets({ type: "all", team: "none" });
    assert.deepEqual(list.items.map((t) => t.ref), ["R-4"]);
    list = await service.tickets({ type: "all", org: "4" });
    assert.deepEqual(list.items.map((t) => t.ref), ["I-3"]);
    list = await service.tickets({ type: "all", priority: "1" });
    assert.equal(list.total, 0);
  });
});

/* ------------------------------------------------------------------------- *
 * Routes: validation happens before iTop is asked
 * ------------------------------------------------------------------------- */

function app(fake: FakeItopClient) {
  const schema = sampleSchema();
  const built = buildApp(testConfig(), {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
  });
  after(async () => {
    await built.app.close();
  });
  return built.app;
}

describe("sla routes", () => {
  it("rejects bad input with 400 and no iTop call", async () => {
    const fake = new FakeItopClient();
    const server = app(fake);
    for (const url of [
      "/api/sla/dashboard?type=problem",
      "/api/sla/tickets?state=late",
      "/api/sla/tickets?team=abc",
      "/api/sla/tickets?priority=5",
      "/api/sla/tickets?org=1%20OR%201",
    ]) {
      const response = await server.inject({ method: "GET", url });
      assert.equal(response.statusCode, 400, url);
    }
    assert.equal(fake.calls.length, 0);
  });
});
