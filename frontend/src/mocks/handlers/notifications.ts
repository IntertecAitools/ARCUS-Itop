import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';

const url = (path: string) => `${env.bffUrl}${path}`;

/** One sample rule, so the notifications screens can be worked on without the BFF. */
let rules = [
  {
    id: 1,
    name: 'Request resolved: tell the caller',
    event: {
      kind: 'state_entered',
      recordType: 'UserRequest',
      state: 'resolved',
      hasCondition: false,
      firesFromPlatform: true,
      labels: { recordType: 'User Request', state: 'Resolved' },
    },
    email: {
      to: [{ kind: 'caller' }],
      cc: [{ kind: 'agent' }],
      subject: 'Your request {{ref}} is resolved',
      body: 'Hello {{caller}},\n\nYour request {{ref}} is resolved.\n\n{{link}}',
      status: 'on',
      testRecipient: '',
      sharedWith: 0,
    },
  },
];

const options = {
  recordTypes: [
    { name: 'Incident', label: 'Incident', ticket: true },
    { name: 'UserRequest', label: 'User Request', ticket: true },
  ],
  states: [
    { code: 'new', label: 'New' },
    { code: 'assigned', label: 'Assigned' },
    { code: 'resolved', label: 'Resolved' },
    { code: 'closed', label: 'Closed' },
  ],
  fields: [
    { code: 'priority', label: 'Priority' },
    { code: 'team_id', label: 'Team' },
  ],
  slaTimers: [
    { code: 'tto', label: 'TTO' },
    { code: 'ttr', label: 'TTR' },
  ],
  slaPercents: ['75', '100'],
  roles: ['caller', 'agent', 'team'],
  tokens: [
    { token: 'ref', label: 'Reference' },
    { token: 'title', label: 'Title' },
    { token: 'caller', label: 'Caller' },
    { token: 'link', label: 'Link to the record' },
  ],
};

export const notificationHandlers = [
  http.get(url('/admin/notifications/rules'), () => HttpResponse.json({ rules })),
  http.get(url('/admin/notifications/rules/:id'), ({ params }) => {
    const rule = rules.find((r) => r.id === Number(params['id']));
    return rule
      ? HttpResponse.json(rule)
      : HttpResponse.json({ error: { code: 'not_found', message: 'No such rule.' } }, { status: 404 });
  }),
  http.get(url('/admin/notifications/options'), () => HttpResponse.json(options)),
  http.get(url('/admin/notifications/sent'), () => HttpResponse.json({ sent: [] })),
  http.patch(url('/admin/notifications/rules/:id/status'), async ({ params, request }) => {
    const { status } = (await request.json()) as { status: string };
    rules = rules.map((r) => (r.id === Number(params['id']) ? { ...r, email: { ...r.email, status } } : r));
    return HttpResponse.json(rules.find((r) => r.id === Number(params['id'])));
  }),
  http.delete(url('/admin/notifications/rules/:id'), ({ params }) => {
    rules = rules.filter((r) => r.id !== Number(params['id']));
    return new HttpResponse(null, { status: 204 });
  }),
];
