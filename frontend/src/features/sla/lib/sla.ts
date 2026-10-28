import type { BadgeTone } from '@/components/ui';
import type {
  SlaCounts,
  SlaDashboard,
  SlaMetric,
  SlaState,
  SlaTicket,
  SlaTicketQuery,
  SlaTicketType,
} from '../types';

export const TYPES: Array<{ value: SlaTicketType; label: string }> = [
  { value: 'all', label: 'Incidents and requests' },
  { value: 'incident', label: 'Incidents' },
  { value: 'request', label: 'User requests' },
];

export const STATES: Array<{ value: SlaState; label: string; tone: BadgeTone; count: keyof SlaCounts }> = [
  { value: 'breached', label: 'Breached', tone: 'critical', count: 'breached' },
  { value: 'at_risk', label: 'At risk', tone: 'warning', count: 'atRisk' },
  { value: 'within', label: 'Within target', tone: 'good', count: 'within' },
  { value: 'none', label: 'No SLA', tone: 'neutral', count: 'none' },
];

export const stateMeta = (state: SlaState) => STATES.find((s) => s.value === state)!;

export const PRIORITY_LABELS: Record<string, string> = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low' };

/** One stopwatch in a few words: "62% used", "Met", "Paused at 40%", "Breached". */
export function metricText(metric: SlaMetric): string {
  const used = metric.percentUsed === null ? '' : `${metric.percentUsed}%`;
  switch (metric.state) {
    case 'breached':
      return used ? `Breached (${used})` : 'Breached';
    case 'at_risk':
    case 'within':
      return used ? `${used} used` : 'Running';
    case 'met':
      return 'Met';
    case 'paused':
      return used ? `Paused at ${used}` : 'Paused';
    default:
      return 'No SLA';
  }
}

export function metricTone(metric: SlaMetric): BadgeTone {
  switch (metric.state) {
    case 'breached':
      return 'critical';
    case 'at_risk':
      return 'warning';
    case 'within':
    case 'met':
      return 'good';
    case 'paused':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Where a ticket opens: the incident screen, or the generic record screen for requests. */
export function ticketHref(ticket: SlaTicket, incidentsRegistered: boolean): string {
  return ticket.className === 'Incident' && incidentsRegistered
    ? `/incidents/${ticket.id}`
    : `/records/${ticket.className}/${ticket.id}`;
}

/* ------------------------------------------------------------------------- *
 * The drill-down lives in the URL, so a filtered list can be shared
 * ------------------------------------------------------------------------- */

const STATE_VALUES = new Set<string>(STATES.map((s) => s.value));
const TYPE_VALUES = new Set<string>(TYPES.map((t) => t.value));

export function queryFromParams(params: URLSearchParams): SlaTicketQuery {
  const type = params.get('type') ?? '';
  const state = params.get('state') ?? '';
  const team = params.get('team') ?? '';
  const priority = params.get('priority') ?? '';
  const org = params.get('org') ?? '';
  return {
    type: TYPE_VALUES.has(type) ? (type as SlaTicketType) : 'all',
    state: STATE_VALUES.has(state) ? (state as SlaState) : undefined,
    team: /^(\d+|none)$/.test(team) ? team : undefined,
    priority: /^[1-4]$/.test(priority) ? priority : undefined,
    org: /^\d+$/.test(org) ? org : undefined,
  };
}

export function paramsFromQuery(query: SlaTicketQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.type !== 'all') out['type'] = query.type;
  if (query.state) out['state'] = query.state;
  if (query.team) out['team'] = query.team;
  if (query.priority) out['priority'] = query.priority;
  if (query.org) out['org'] = query.org;
  return out;
}

export const isDrilledDown = (q: SlaTicketQuery) => Boolean(q.state || q.team || q.priority || q.org);

/** "Breached · Team: Service desk · Priority: High", from the dashboard's own labels. */
export function drillDownTitle(query: SlaTicketQuery, dashboard: SlaDashboard | undefined): string {
  const parts: string[] = [];
  if (query.state) parts.push(stateMeta(query.state).label);
  if (query.team) {
    const key = query.team === 'none' ? '' : query.team;
    parts.push(`Team: ${dashboard?.byTeam.find((g) => g.key === key)?.label ?? (key ? `#${key}` : 'No team')}`);
  }
  if (query.priority) parts.push(`Priority: ${PRIORITY_LABELS[query.priority] ?? query.priority}`);
  if (query.org) {
    parts.push(`Customer: ${dashboard?.byCustomer.find((g) => g.key === query.org)?.label ?? `#${query.org}`}`);
  }
  return parts.length ? parts.join(' · ') : 'All open tickets';
}

/** Share of a group in a state, for the stacked bar. */
export const share = (part: number, total: number) => (total ? (part / total) * 100 : 0);
