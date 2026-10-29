import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  AssignmentRule,
  AssignmentRules,
  AssignmentRulesDto,
  RoutingFacts,
  TeamQueue,
  TeamQueueItem,
  TicketType,
} from '@/features/dispatch';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock team dispatch: two tickets waiting in the "Network" team's queue,
 * and the assignment rules in memory. Taking a ticket removes it from the
 * queue, as the BFF's ev_assign does.
 */
const TEAMS = [{ id: '7', name: 'Network' }];

const seedQueue = (): TeamQueueItem[] => [
  {
    type: 'incident',
    id: '42',
    ref: 'I-000042',
    summary: 'Branch office VPN down',
    priority: 'high',
    team: TEAMS[0]!,
    organization: 'Demo',
    service: 'Network',
    createdAt: '2026-10-28T08:00:00Z',
    dispatchedAt: '2026-10-28T08:01:00Z',
    ttoDeadline: '2026-10-28T09:00:00Z',
    escalated: false,
  },
  {
    type: 'request',
    id: '43',
    ref: 'R-000043',
    summary: 'New Wi-Fi access point for floor 3',
    priority: 'low',
    team: TEAMS[0]!,
    createdAt: '2026-10-28T09:00:00Z',
    dispatchedAt: '2026-10-28T09:05:00Z',
    escalated: true,
  },
];

let queue = seedQueue();
let rules: AssignmentRules = { rules: [], notifyTeam: false };
let updatedAt = '';

const rulesDto = (): AssignmentRulesDto => ({
  ...structuredClone(rules),
  available: true,
  mailConfigured: true,
  updatedAt,
  updatedBy: updatedAt ? 'admin' : '',
});

const matches = (rule: AssignmentRule, facts: RoutingFacts) =>
  rule.enabled &&
  (!rule.ticketType || rule.ticketType === facts.ticketType) &&
  (!rule.organizationId || rule.organizationId === facts.organizationId) &&
  (!rule.serviceId || rule.serviceId === facts.serviceId) &&
  (!rule.serviceSubcategoryId || rule.serviceSubcategoryId === facts.serviceSubcategoryId);

export const dispatchHandlers = [
  http.get(url('/dispatch/queue'), () =>
    HttpResponse.json<TeamQueue>({ teams: TEAMS, items: queue, available: true, truncated: false }),
  ),

  http.post(url('/dispatch/:type/:id/take'), ({ params }) => {
    const item = queue.find((q) => q.type === params.type && q.id === params.id);
    if (!item) {
      return HttpResponse.json(
        { error: { code: 'conflict', message: 'It has already been taken.' } },
        { status: 409 },
      );
    }
    queue = queue.filter((q) => q !== item);
    return HttpResponse.json({ type: item.type as TicketType, id: item.id, ref: item.ref });
  }),

  http.get(url('/admin/assignment-rules'), () => HttpResponse.json(rulesDto())),

  http.put(url('/admin/assignment-rules'), async ({ request }) => {
    rules = (await request.json()) as AssignmentRules;
    updatedAt = new Date().toISOString();
    return HttpResponse.json(rulesDto());
  }),

  http.post(url('/admin/assignment-rules/test'), async ({ request }) => {
    const facts = (await request.json()) as RoutingFacts;
    const rule = rules.rules.find((r) => matches(r, facts));
    return HttpResponse.json(rule ? { rule } : {});
  }),
];

/** Puts the mock back as it started (tests). */
export function resetDispatchMock() {
  queue = seedQueue();
  rules = { rules: [], notifyTeam: false };
  updatedAt = '';
}
