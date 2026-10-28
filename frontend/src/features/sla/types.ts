// sla: feature types. The same JSON as backend/src/modules/sla/sla.types.ts.

/** Where an open ticket stands against its SLA, worst of TTO and TTR. */
export type SlaState = 'within' | 'at_risk' | 'breached' | 'none';

/**
 * One stopwatch (TTO or TTR):
 *  - within / at_risk / breached: running, or already missed;
 *  - met: stopped in time (TTO once the ticket is assigned);
 *  - paused: stopped for now (TTR while pending), `percentUsed` is what it had used;
 *  - none: no SLT applies to the ticket for this metric.
 */
export type SlaMetricState = 'within' | 'at_risk' | 'breached' | 'met' | 'paused' | 'none';

export interface SlaMetric {
  state: SlaMetricState;
  /** ISO instant the target runs out; null when stopped or without SLT. */
  deadline: string | null;
  /** Share of the target used so far, rounded; null when not known. */
  percentUsed: number | null;
  /** The SLT target in seconds, as iTop picks it (shortest matching SLT). */
  goalSeconds: number | null;
}

export type SlaTicketClass = 'Incident' | 'UserRequest';

export interface SlaTicket {
  id: string;
  className: SlaTicketClass;
  ref: string;
  title: string;
  status: string;
  /** iTop's priority code, '1' (critical) to '4' (low). */
  priority: string;
  orgId: string;
  orgName: string;
  /** '' when no team is assigned. */
  teamId: string;
  teamName: string;
  agentName: string;
  startDate: string;
  state: SlaState;
  tto: SlaMetric;
  ttr: SlaMetric;
}

export interface SlaCounts {
  within: number;
  atRisk: number;
  breached: number;
  none: number;
  total: number;
}

export interface SlaGroup extends SlaCounts {
  /** Team / organisation id, or the priority code; '' for 'no team'. */
  key: string;
  label: string;
}

export type SlaTicketType = 'all' | 'incident' | 'request';

export interface SlaDashboard {
  generatedAt: string;
  type: SlaTicketType;
  /** Percent of a target used from which a ticket counts as at risk. */
  atRiskPercent: number;
  totals: SlaCounts;
  byTeam: SlaGroup[];
  byPriority: SlaGroup[];
  byCustomer: SlaGroup[];
  /** More open tickets than the dashboard reads; the counts cover the first ones. */
  truncated: boolean;
}

export interface SlaTicketQuery {
  type: SlaTicketType;
  state?: SlaState | undefined;
  /** Team id; 'none' for tickets without a team. */
  team?: string | undefined;
  priority?: string | undefined;
  org?: string | undefined;
}

export interface SlaTicketList {
  items: SlaTicket[];
  total: number;
  truncated: boolean;
}
