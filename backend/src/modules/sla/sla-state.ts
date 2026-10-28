import { itopTimeToIso } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import type {
  SlaCounts,
  SlaGroup,
  SlaMetric,
  SlaMetricState,
  SlaState,
  SlaTicket,
  SlaTicketClass,
  SlaTicketQuery,
} from "./sla.types.js";

/**
 * The SLA arithmetic, kept free of I/O so it can be tested on plain rows.
 *
 * iTop runs a TTO and a TTR stopwatch on each ticket (AttributeStopWatch).
 * Over REST we see, per metric, the 100% deadline (`tto_escalation_deadline`),
 * whether it has passed (`sla_tto_passed`) and the time spent at the last stop
 * (`tto_time_spent`). The 75% threshold exists in the datamodel but is not
 * exposed, so "at risk" is worked out here from the target: iTop picks the
 * shortest SLT whose metric, request type and priority match, among the SLAs
 * of the customer contracts of the ticket's organisation that cover its
 * service (RESPONSE_TICKET_SLT_QUERY in itop-tickets). The same choice is
 * made here from three small link tables.
 *
 * Time is counted the way iTop counts it: wall clock by default (24x7), or,
 * with Combodo's business-hours modules, only the open hours of the coverage
 * window of the ticket's contract service, holidays left out (`span`).
 */

export const AT_RISK_PERCENT = 75;

export type Metric = "tto" | "ttr";

/** States in which each class's TTO stopwatch runs; outside them a stopped TTO was met. */
const TTO_RUNNING: Record<SlaTicketClass, readonly string[]> = {
  Incident: ["new", "escalated_tto"],
  UserRequest: ["new", "escalated_tto", "approved"],
};

/** Statuses that are no longer open, per class. */
export const CLOSED_STATUSES: Record<SlaTicketClass, readonly string[]> = {
  Incident: ["resolved", "closed"],
  UserRequest: ["resolved", "closed", "rejected"],
};

export const TICKET_FIELDS = [
  "ref",
  "title",
  "status",
  "priority",
  "org_id",
  "org_name",
  "team_id",
  "team_name",
  "agent_name",
  "service_id",
  "start_date",
  "tto_escalation_deadline",
  "ttr_escalation_deadline",
  "sla_tto_passed",
  "sla_ttr_passed",
  "tto_time_spent",
  "ttr_time_spent",
];

/* ------------------------------------------------------------------------- *
 * Targets
 * ------------------------------------------------------------------------- */

export interface ContractRow {
  id: string;
  orgId: string;
}
export interface ContractServiceRow {
  contractId: string;
  serviceId: string;
  slaId: string;
}
export interface SlaSltRow {
  slaId: string;
  metric: string;
  requestType: string;
  priority: string;
  value: number;
  unit: string;
}

export function sltSeconds(value: number, unit: string): number {
  switch (unit) {
    case "days":
      return value * 86_400;
    case "hours":
      return value * 3_600;
    case "minutes":
      return value * 60;
    default:
      return value;
  }
}

const goalKey = (orgId: string, serviceId: string, requestType: string, priority: string, metric: string) =>
  `${orgId}|${serviceId}|${requestType}|${priority}|${metric}`;

/** Looks up the SLT target, in seconds, iTop would pick for a ticket. */
export type GoalLookup = (
  orgId: string,
  serviceId: string,
  requestType: string,
  priority: string,
  metric: Metric,
) => number | null;

export function buildGoals(
  contracts: ContractRow[],
  contractServices: ContractServiceRow[],
  slaSlts: SlaSltRow[],
): GoalLookup {
  const orgOf = new Map(contracts.map((c) => [c.id, c.orgId]));
  const sltsOf = new Map<string, SlaSltRow[]>();
  for (const row of slaSlts) {
    const list = sltsOf.get(row.slaId) ?? [];
    list.push(row);
    sltsOf.set(row.slaId, list);
  }
  const goals = new Map<string, number>();
  for (const link of contractServices) {
    const orgId = orgOf.get(link.contractId);
    if (!orgId) continue;
    for (const slt of sltsOf.get(link.slaId) ?? []) {
      const key = goalKey(orgId, link.serviceId, slt.requestType, slt.priority, slt.metric);
      const seconds = sltSeconds(slt.value, slt.unit);
      const current = goals.get(key);
      if (current === undefined || seconds < current) goals.set(key, seconds);
    }
  }
  return (orgId, serviceId, requestType, priority, metric) =>
    goals.get(goalKey(orgId, serviceId, requestType, priority, metric)) ?? null;
}

/* ------------------------------------------------------------------------- *
 * One ticket
 * ------------------------------------------------------------------------- */

/** A datetime as the objects layer returns it (ISO) or as iTop writes it. */
function instant(value: unknown, timeZone: string): number | null {
  const text = str(value).trim();
  if (!text) return null;
  const iso = text.includes("T") ? text : itopTimeToIso(text, timeZone);
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

const yes = (value: unknown) => str(value).toLowerCase() === "yes" || value === true || value === 1;

const byPercent = (percent: number): SlaMetricState =>
  percent >= 100 ? "breached" : percent >= AT_RISK_PERCENT ? "at_risk" : "within";

export interface MetricInput {
  metric: Metric;
  className: SlaTicketClass;
  status: string;
  startMs: number | null;
  deadlineMs: number | null;
  passed: boolean;
  timeSpent: number;
  goal: number | null;
  nowMs: number;
  /** Seconds that count between two instants; wall clock when absent. */
  span?: ((fromMs: number, toMs: number) => number) | undefined;
}

const wallClock = (fromMs: number, toMs: number) => (toMs - fromMs) / 1000;

export function metricState(input: MetricInput): SlaMetric {
  const { deadlineMs, goal, nowMs } = input;
  const span = input.span ?? wallClock;
  const deadline = deadlineMs === null ? null : new Date(deadlineMs).toISOString();
  const result = (state: SlaMetricState, percentUsed: number | null): SlaMetric => ({
    state,
    deadline,
    percentUsed: percentUsed === null ? null : Math.max(0, Math.round(percentUsed)),
    goalSeconds: goal,
  });

  if (deadlineMs !== null) {
    const remaining = span(nowMs, deadlineMs);
    let percent: number | null = null;
    if (goal) percent = ((goal - remaining) / goal) * 100;
    else if (input.startMs !== null && deadlineMs > input.startMs) {
      // A deadline without a target we can match (the SLTs changed since it
      // was set): fall back to the share of the window from start to deadline.
      const window = span(input.startMs, deadlineMs);
      if (window > 0) percent = (span(input.startMs, nowMs) / window) * 100;
    }
    if (input.passed || nowMs >= deadlineMs) return result("breached", Math.max(percent ?? 100, 100));
    // Before the deadline it is not breached, even with no open time left
    // (the deadline sits at the next opening, say).
    if (percent !== null) percent = Math.min(percent, 99);
    return result(percent === null ? "within" : byPercent(percent), percent);
  }

  if (input.passed) {
    return result("breached", goal ? Math.max((input.timeSpent / goal) * 100, 100) : null);
  }
  if (!goal) return result("none", null);

  const percent = (input.timeSpent / goal) * 100;
  if (input.metric === "tto" && !TTO_RUNNING[input.className].includes(input.status)) {
    return result("met", percent);
  }
  return result("paused", percent);
}

const RANK: Record<SlaState, number> = { none: 0, within: 1, at_risk: 2, breached: 3 };

function metricToTicketState(metric: SlaMetric): SlaState {
  switch (metric.state) {
    case "breached":
      return "breached";
    case "at_risk":
      return "at_risk";
    case "paused":
      return metric.percentUsed !== null && metric.percentUsed >= AT_RISK_PERCENT ? "at_risk" : "within";
    case "within":
    case "met":
      return "within";
    default:
      return "none";
  }
}

/** The worse of the two stopwatches. */
export function ticketState(tto: SlaMetric, ttr: SlaMetric): SlaState {
  const a = metricToTicketState(tto);
  const b = metricToTicketState(ttr);
  return RANK[a] >= RANK[b] ? a : b;
}

export interface TicketRow {
  className: SlaTicketClass;
  id: number;
  fields: Record<string, unknown>;
}

/** Seconds that count between two instants for a ticket of this organisation and service; null for wall clock. */
export type SpanLookup = (orgId: string, serviceId: string) => ((fromMs: number, toMs: number) => number) | null;

export function toSlaTicket(
  row: TicketRow,
  goals: GoalLookup,
  nowMs: number,
  timeZone: string,
  spanFor: SpanLookup = () => null,
): SlaTicket {
  const f = row.fields;
  const status = str(f["status"]);
  const priority = str(f["priority"]);
  const orgId = str(f["org_id"]);
  const serviceId = str(f["service_id"]);
  const requestType = row.className === "Incident" ? "incident" : "service_request";
  const startMs = instant(f["start_date"], timeZone);
  const span = spanFor(orgId, serviceId) ?? undefined;
  const metric = (m: Metric): SlaMetric =>
    metricState({
      metric: m,
      className: row.className,
      status,
      startMs,
      deadlineMs: instant(f[`${m}_escalation_deadline`], timeZone),
      passed: yes(f[`sla_${m}_passed`]),
      timeSpent: Number(f[`${m}_time_spent`]) || 0,
      goal: goals(orgId, serviceId, requestType, priority, m),
      nowMs,
      span,
    });
  const tto = metric("tto");
  const ttr = metric("ttr");
  const teamId = str(f["team_id"]);
  return {
    id: String(row.id),
    className: row.className,
    ref: str(f["ref"]),
    title: str(f["title"]),
    status,
    priority,
    orgId,
    orgName: str(f["org_name"]),
    teamId: teamId === "0" ? "" : teamId,
    teamName: teamId && teamId !== "0" ? str(f["team_name"]) : "",
    agentName: str(f["agent_name"]),
    startDate: startMs === null ? "" : new Date(startMs).toISOString(),
    state: ticketState(tto, ttr),
    tto,
    ttr,
  };
}

/* ------------------------------------------------------------------------- *
 * Counting
 * ------------------------------------------------------------------------- */

export const emptyCounts = (): SlaCounts => ({ within: 0, atRisk: 0, breached: 0, none: 0, total: 0 });

function add(counts: SlaCounts, state: SlaState): void {
  counts.total += 1;
  if (state === "within") counts.within += 1;
  else if (state === "at_risk") counts.atRisk += 1;
  else if (state === "breached") counts.breached += 1;
  else counts.none += 1;
}

export function countStates(tickets: SlaTicket[]): SlaCounts {
  const counts = emptyCounts();
  for (const t of tickets) add(counts, t.state);
  return counts;
}

/** Groups, worst first: most breached, then most at risk, then largest. */
export function groupBy(
  tickets: SlaTicket[],
  keyOf: (t: SlaTicket) => string,
  labelOf: (t: SlaTicket) => string,
): SlaGroup[] {
  const groups = new Map<string, SlaGroup>();
  for (const t of tickets) {
    const key = keyOf(t);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: labelOf(t), ...emptyCounts() };
      groups.set(key, group);
    }
    add(group, t.state);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.breached - a.breached || b.atRisk - a.atRisk || b.total - a.total || a.label.localeCompare(b.label),
  );
}

export const PRIORITY_LABELS: Record<string, string> = {
  "1": "Critical",
  "2": "High",
  "3": "Medium",
  "4": "Low",
};

export function byPriority(tickets: SlaTicket[]): SlaGroup[] {
  return groupBy(tickets, (t) => t.priority, (t) => PRIORITY_LABELS[t.priority] ?? (t.priority || "None")).sort(
    (a, b) => (a.key || "9").localeCompare(b.key || "9"),
  );
}

export function matches(t: SlaTicket, query: SlaTicketQuery): boolean {
  if (query.state && t.state !== query.state) return false;
  if (query.team !== undefined && (query.team === "none" ? t.teamId !== "" : t.teamId !== query.team)) return false;
  if (query.priority && t.priority !== query.priority) return false;
  if (query.org && t.orgId !== query.org) return false;
  return true;
}

const STATE_ORDER: Record<SlaState, number> = { breached: 0, at_risk: 1, within: 2, none: 3 };

/** Most urgent first: worst state, then the highest share of target used. */
export function byUrgency(a: SlaTicket, b: SlaTicket): number {
  const used = (t: SlaTicket) => Math.max(t.tto.percentUsed ?? -1, t.ttr.percentUsed ?? -1);
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || used(b) - used(a) || a.ref.localeCompare(b.ref);
}
