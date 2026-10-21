import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { RecipientInput, Rule, RuleInput } from '@/features/notifications/types';
import { records } from '../fixtures/records';

const url = (path: string) => `${env.bffUrl}${path}`;

/** One sample rule, so the notifications screens can be worked on without the BFF. */
let rules: Rule[] = [
  {
    id: 1,
    name: 'Request resolved: tell the caller',
    event: {
      kind: 'state_entered',
      recordType: 'UserRequest',
      state: 'resolved',
      hasCondition: false,
      conditions: [],
      keptCondition: false,
      valueLabels: {},
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
    inApp: { on: true, message: '{{ref}} was resolved' },
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

const label = (list: { code: string; label: string }[], code?: string) =>
  list.find((x) => x.code === code)?.label ?? code;

/** What the BFF answers after a save: the input, read back with display names. */
function toRule(id: number, input: RuleInput): Rule {
  const recipients = (list: RecipientInput[]) =>
    list.map((r) =>
      r.kind === 'people'
        ? {
            kind: 'people' as const,
            people: r.ids.map((pid) => ({ id: pid, name: records.Person?.find((p) => p.id === pid)?.label ?? `#${pid}` })),
          }
        : r,
    );
  const recordType = options.recordTypes.find((t) => t.name === input.event.recordType)?.label ?? input.event.recordType;
  const state = label(options.states, input.event.state);
  return {
    id,
    name: input.name,
    event: {
      ...input.event,
      conditions: input.event.conditions ?? [],
      hasCondition: (input.event.conditions?.length ?? 0) > 0,
      keptCondition: false,
      valueLabels: {},
      firesFromPlatform: true,
      labels: { recordType, ...(state ? { state } : {}) },
    },
    email: {
      to: recipients(input.email.to),
      cc: recipients(input.email.cc),
      subject: input.email.subject,
      body: input.email.body,
      status: input.email.status,
      testRecipient: input.email.testRecipient ?? '',
      sharedWith: 0,
    },
    inApp: input.inApp ?? { on: false, message: '' },
  };
}

const refused = (message: string) =>
  HttpResponse.json({ error: { code: 'validation_failed', message } }, { status: 422 });

/** The BFF's own checks, so the editor's error path can be seen without it. */
function invalid(input: RuleInput) {
  if (!input.name.trim()) return 'Give the rule a name.';
  if (!input.email.subject.trim()) return 'The email needs a subject.';
  if (input.email.to.length === 0) return 'Choose who the email goes to.';
  return null;
}

export const notificationHandlers = [
  http.post(url('/admin/notifications/rules'), async ({ request }) => {
    const input = (await request.json()) as RuleInput;
    const problem = invalid(input);
    if (problem) return refused(problem);
    const rule = toRule(Math.max(0, ...rules.map((r) => r.id)) + 1, input);
    rules = [...rules, rule];
    return HttpResponse.json(rule, { status: 201 });
  }),
  http.put(url('/admin/notifications/rules/:id'), async ({ params, request }) => {
    const input = (await request.json()) as RuleInput;
    const problem = invalid(input);
    if (problem) return refused(problem);
    const rule = toRule(Number(params['id']), input);
    rules = rules.map((r) => (r.id === rule.id ? rule : r));
    return HttpResponse.json(rule);
  }),
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
    const { status } = (await request.json()) as { status: Rule['email']['status'] };
    rules = rules.map((r) => (r.id === Number(params['id']) ? { ...r, email: { ...r.email, status } } : r));
    return HttpResponse.json(rules.find((r) => r.id === Number(params['id'])));
  }),
  http.delete(url('/admin/notifications/rules/:id'), ({ params }) => {
    rules = rules.filter((r) => r.id !== Number(params['id']));
    return new HttpResponse(null, { status: 204 });
  }),
];
