import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  SlaCounts,
  SlaDashboard,
  SlaGroup,
  SlaMetric,
  SlaState,
  SlaTicket,
  SlaTicketType,
} from '@/features/sla';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock SLA dashboard: a handful of open tickets in every state, counted and
 * filtered the way the BFF does it (backend/src/modules/sla).
 */
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const metric = (state: SlaMetric['state'], percentUsed: number | null, deadlineIn?: number): SlaMetric => ({
  state,
  percentUsed,
  deadline: deadlineIn === undefined ? null : minutesFromNow(deadlineIn),
  goalSeconds: percentUsed === null ? null : 4 * 3600,
});

function ticket(
  id: string,
  className: SlaTicket['className'],
  state: SlaState,
  tto: SlaMetric,
  ttr: SlaMetric,
  extra: Partial<SlaTicket>,
): SlaTicket {
  return {
    id,
    className,
    ref: `${className === 'Incident' ? 'I' : 'R'}-${id.padStart(6, '0')}`,
    title: 'Ticket',
    status: 'assigned',
    priority: '2',
    orgId: '3',
    orgName: 'Demo Customer',
    teamId: '5',
    teamName: 'Service desk',
    agentName: 'Agnes Agent',
    startDate: minutesFromNow(-180),
    state,
    tto,
    ttr,
    ...extra,
  };
}

const TICKETS: SlaTicket[] = [
  ticket('41', 'Incident', 'breached', metric('met', 40), metric('breached', 112, -30), {
    title: 'Mail relay down',
    priority: '1',
  }),
  ticket('42', 'Incident', 'at_risk', metric('met', 20), metric('at_risk', 81, 45), {
    title: 'VPN drops every hour',
    teamId: '6',
    teamName: 'Network',
    agentName: 'Nils Network',
  }),
  ticket('43', 'Incident', 'within', metric('within', 30, 40), metric('within', 10, 210), {
    title: 'Printer offline on floor 2',
    status: 'new',
    teamId: '',
    teamName: '',
    agentName: '',
    priority: '3',
  }),
  ticket('44', 'UserRequest', 'within', metric('met', 15), metric('paused', 35), {
    title: 'New laptop for Sam',
    status: 'pending',
    orgId: '4',
    orgName: 'Globex',
  }),
  ticket('45', 'UserRequest', 'none', metric('none', null), metric('none', null), {
    title: 'Access to the finance share',
    orgId: '4',
    orgName: 'Globex',
    priority: '4',
  }),
];

const PRIORITY_LABELS: Record<string, string> = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low' };

function counts(list: SlaTicket[]): SlaCounts {
  return {
    within: list.filter((t) => t.state === 'within').length,
    atRisk: list.filter((t) => t.state === 'at_risk').length,
    breached: list.filter((t) => t.state === 'breached').length,
    none: list.filter((t) => t.state === 'none').length,
    total: list.length,
  };
}

function groups(list: SlaTicket[], key: (t: SlaTicket) => string, label: (t: SlaTicket) => string): SlaGroup[] {
  const keys = [...new Set(list.map(key))];
  return keys
    .map((k) => {
      const members = list.filter((t) => key(t) === k);
      return { key: k, label: label(members[0]!), ...counts(members) };
    })
    .sort((a, b) => b.breached - a.breached || b.atRisk - a.atRisk || b.total - a.total);
}

function ofType(type: string | null): SlaTicket[] {
  if (type === 'incident') return TICKETS.filter((t) => t.className === 'Incident');
  if (type === 'request') return TICKETS.filter((t) => t.className === 'UserRequest');
  return TICKETS;
}

export const slaHandlers = [
  http.get(url('/sla/dashboard'), ({ request }) => {
    const type = new URL(request.url).searchParams.get('type');
    const list = ofType(type);
    const body: SlaDashboard = {
      generatedAt: new Date().toISOString(),
      type: (type ?? 'all') as SlaTicketType,
      atRiskPercent: 75,
      totals: counts(list),
      byTeam: groups(list, (t) => t.teamId, (t) => t.teamName || 'No team'),
      byPriority: groups(list, (t) => t.priority, (t) => PRIORITY_LABELS[t.priority] ?? 'None').sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      byCustomer: groups(list, (t) => t.orgId, (t) => t.orgName),
      truncated: false,
    };
    return HttpResponse.json(body);
  }),

  http.get(url('/sla/tickets'), ({ request }) => {
    const p = new URL(request.url).searchParams;
    const team = p.get('team');
    const items = ofType(p.get('type')).filter(
      (t) =>
        (!p.get('state') || t.state === p.get('state')) &&
        (!team || (team === 'none' ? t.teamId === '' : t.teamId === team)) &&
        (!p.get('priority') || t.priority === p.get('priority')) &&
        (!p.get('org') || t.orgId === p.get('org')),
    );
    return HttpResponse.json({ items, total: items.length, truncated: false });
  }),
];
