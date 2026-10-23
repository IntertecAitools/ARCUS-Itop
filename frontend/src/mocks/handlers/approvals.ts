import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { ApprovalDetail, ApprovalSummary, RecordApproval } from '@/features/approvals';
import { currentMockUser } from './auth';

const url = (path: string) => `${env.bffUrl}${path}`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Two approvals for whoever is signed in: one waiting for their answer at the
 * first of two levels, one they approved last week. Answers change the state
 * for the rest of the page's life, as the BFF would.
 */
function seed(): ApprovalDetail[] {
  return [
    {
      id: 7,
      status: 'pending',
      awaitingMe: true,
      myAnswer: null,
      level: 1,
      levels: 2,
      startedAt: ago(2 * 3_600_000),
      endedAt: '',
      request: {
        id: 3310,
        ref: 'R-003310',
        title: 'Laptop for the new hire in Finance',
        requester: 'Kiran Rao',
        organization: 'Intertec',
        service: 'Hardware',
        subcategory: 'New laptop',
        createdAt: ago(2 * 3_600_000),
      },
      description: 'Maya starts on Monday and needs a standard laptop with the Finance image.',
      steps: [
        { level: 1, status: 'in_progress', approvers: [{ name: 'You', decision: null, comment: '', at: '', answeredBy: '' }] },
        { level: 2, status: 'waiting', approvers: [{ name: 'Dana Lee', decision: null, comment: '', at: '', answeredBy: '' }] },
      ],
    },
    {
      id: 5,
      status: 'approved',
      awaitingMe: false,
      myAnswer: { decision: 'approved', comment: 'Budgeted.', at: ago(6 * 86_400_000) },
      level: 1,
      levels: 1,
      startedAt: ago(7 * 86_400_000),
      endedAt: ago(6 * 86_400_000),
      request: {
        id: 3288,
        ref: 'R-003288',
        title: 'Access to the analytics workspace',
        requester: 'Sam Ortiz',
        organization: 'Intertec',
        service: 'Access',
        subcategory: 'Software access',
        createdAt: ago(7 * 86_400_000),
      },
      description: 'Read access for the quarterly report.',
      steps: [
        {
          level: 1,
          status: 'approved',
          approvers: [{ name: 'You', decision: 'approved', comment: 'Budgeted.', at: ago(6 * 86_400_000), answeredBy: '' }],
        },
      ],
    },
  ];
}

let approvals = seed();

const summary = ({ description: _d, steps: _s, ...rest }: ApprovalDetail): ApprovalSummary => rest;
const pending = () => approvals.filter((a) => a.awaitingMe).length;
const asRecord = (a: ApprovalDetail): RecordApproval => ({
  id: a.id,
  status: a.status,
  startedAt: a.startedAt,
  endedAt: a.endedAt,
  steps: a.steps,
});

function answer(id: number, decision: 'approved' | 'rejected', comment: string) {
  const a = approvals.find((x) => x.id === id);
  if (!a) return HttpResponse.json({ error: { code: 'not_found', message: `No approval ${id}.` } }, { status: 404 });
  if (!a.awaitingMe) {
    return HttpResponse.json({ error: { code: 'conflict', message: 'Your answer is not awaited on this approval any more.' } }, { status: 409 });
  }
  if (decision === 'rejected' && !comment.trim()) {
    return HttpResponse.json({ error: { code: 'bad_request', message: 'Say why you reject it: a comment is required.' } }, { status: 400 });
  }
  const at = new Date().toISOString();
  const name = currentMockUser().name;
  const steps = a.steps.map((s, i) =>
    i === a.level - 1
      ? { ...s, status: decision, approvers: s.approvers.map((p) => ({ ...p, name, decision, comment, at })) }
      : i === a.level && decision === 'approved'
        ? { ...s, status: 'in_progress' as const }
        : s,
  );
  const last = a.level >= a.levels || decision === 'rejected';
  const next: ApprovalDetail = {
    ...a,
    steps,
    awaitingMe: false,
    myAnswer: { decision, comment, at },
    status: last ? decision : 'pending',
    level: last ? a.level : a.level + 1,
    endedAt: last ? at : '',
  };
  approvals = approvals.map((x) => (x.id === id ? next : x));
  return HttpResponse.json(next);
}

export const approvalHandlers = [
  http.get(url('/me/approvals/count'), () => HttpResponse.json({ pending: pending() })),
  http.get(url('/me/approvals'), ({ request }) => {
    const state = new URL(request.url).searchParams.get('state') ?? 'pending';
    const items = approvals.filter((a) => (state === 'pending' ? a.awaitingMe : a.myAnswer)).map(summary);
    return HttpResponse.json({ items, pending: pending() });
  }),
  http.get(url('/me/approvals/:id'), ({ params }) => {
    const a = approvals.find((x) => x.id === Number(params['id']));
    return a
      ? HttpResponse.json(a)
      : HttpResponse.json({ error: { code: 'not_found', message: `No approval ${String(params['id'])}.` } }, { status: 404 });
  }),
  http.post(url('/me/approvals/:id/approve'), async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return answer(Number(params['id']), 'approved', body.comment ?? '');
  }),
  http.post(url('/me/approvals/:id/reject'), async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return answer(Number(params['id']), 'rejected', body.comment ?? '');
  }),
  http.get(url('/approvals/requests/:id'), ({ params }) => {
    const a = approvals.find((x) => x.request.id === Number(params['id']));
    return HttpResponse.json({ approval: a ? asRecord(a) : null });
  }),
  http.get(url('/portal/requests/:id/approval'), ({ params }) => {
    const a = approvals.find((x) => x.request.id === Number(params['id']));
    return HttpResponse.json({ approval: a ? asRecord(a) : null });
  }),
];
