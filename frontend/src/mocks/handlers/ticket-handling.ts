import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  Draft,
  DraftKind,
  DuplicateCandidate,
  DuplicateQuery,
  HandledClass,
  TicketHandling,
  TicketWorklog,
  WorklogEntry,
  WorklogReport,
} from '@/features/ticket-handling';
import type { TicketPriority } from '@/types/ticket';
import { currentMockUser } from './auth';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock ticket handling: every incident or request is open and Medium until
 * something is done to it here; overrides, duplicates, cancellations, time
 * and drafts are kept in memory, as the BFF keeps them in its database.
 */
const LABEL: Record<TicketPriority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const refOf = (cls: HandledClass, id: number | string) => `${cls === 'Incident' ? 'I' : 'R'}-${String(id).padStart(6, '0')}`;

let tickets = new Map<string, TicketHandling>();
let worklogs: WorklogEntry[] = [];
let drafts: Draft[] = [];
let nextEntry = 1;

const keyOf = (cls: string, id: string | number) => `${cls}:${id}`;

function ticket(cls: HandledClass, id: string | number): TicketHandling {
  const key = keyOf(cls, id);
  let t = tickets.get(key);
  if (!t) {
    t = {
      class: cls,
      id: Number(id),
      ref: refOf(cls, id),
      open: true,
      priority: 'medium',
      duplicates: [],
      can: { overridePriority: true, markDuplicate: true, cancel: true, logTime: true },
      worklog: { totalMinutes: 0, entries: 0 },
    };
    tickets.set(key, t);
  }
  const entries = worklogs.filter((w) => w.class === cls && w.ticketId === Number(id));
  t.worklog = { totalMinutes: entries.reduce((n, e) => n + e.minutes, 0), entries: entries.length };
  return t;
}

const closeIt = (t: TicketHandling) => {
  t.open = false;
  t.can = { overridePriority: false, markDuplicate: false, cancel: false, logTime: true };
};

const bad = (message: string) => HttpResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });

function worklogOf(cls: HandledClass, id: number): TicketWorklog {
  const me = Number(currentMockUser().id);
  const entries = worklogs.filter((w) => w.class === cls && w.ticketId === id).map((w) => ({ ...w, mine: w.agent.userId === me }));
  const byAgent = new Map<number, { userId: number; name: string; minutes: number; entries: number }>();
  for (const e of entries) {
    const a = byAgent.get(e.agent.userId) ?? { userId: e.agent.userId, name: e.agent.name, minutes: 0, entries: 0 };
    a.minutes += e.minutes;
    a.entries += 1;
    byAgent.set(e.agent.userId, a);
  }
  return { entries, totalMinutes: entries.reduce((n, e) => n + e.minutes, 0), byAgent: [...byAgent.values()] };
}

const SEED_CANDIDATES: DuplicateCandidate[] = [
  {
    class: 'Incident',
    id: 42,
    ref: 'I-000042',
    title: 'Branch office VPN down',
    status: 'dispatched',
    caller: 'Jane Doe',
    createdAt: '2026-10-28T08:00:00Z',
    score: 0.7,
    reasons: ['same caller', 'similar title'],
  },
];

export const ticketHandlingHandlers = [
  http.get(url('/ticket-handling/worklogs/report'), () => {
    const totals = new Map<string, WorklogReport['byTicket'][number]>();
    for (const w of worklogs) {
      const t = totals.get(keyOf(w.class, w.ticketId)) ?? { class: w.class, ticketId: w.ticketId, ticketRef: w.ticketRef, minutes: 0, entries: 0 };
      t.minutes += w.minutes;
      t.entries += 1;
      totals.set(keyOf(w.class, w.ticketId), t);
    }
    const byAgent = new Map<number, WorklogReport['byAgent'][number]>();
    for (const w of worklogs) {
      const a = byAgent.get(w.agent.userId) ?? { userId: w.agent.userId, name: w.agent.name, minutes: 0, entries: 0 };
      a.minutes += w.minutes;
      a.entries += 1;
      byAgent.set(w.agent.userId, a);
    }
    const today = new Date().toISOString().slice(0, 10);
    return HttpResponse.json<WorklogReport>({
      from: today,
      to: today,
      totalMinutes: worklogs.reduce((n, w) => n + w.minutes, 0),
      byAgent: [...byAgent.values()],
      byTicket: [...totals.values()],
    });
  }),

  http.delete(url('/ticket-handling/worklogs/:entryId'), ({ params }) => {
    const entry = worklogs.find((w) => w.id === Number(params.entryId));
    if (!entry) return HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
    worklogs = worklogs.filter((w) => w !== entry);
    return HttpResponse.json(worklogOf(entry.class, entry.ticketId));
  }),

  http.post(url('/ticket-handling/duplicates/suggest'), async ({ request }) => {
    const query = (await request.json()) as DuplicateQuery;
    const words = query.title.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const items = SEED_CANDIDATES.filter((c) => words.some((w) => c.title.toLowerCase().includes(w)));
    return HttpResponse.json({ items });
  }),

  http.get(url('/ticket-handling/:class/:id'), ({ params }) =>
    HttpResponse.json(ticket(params.class as HandledClass, String(params.id))),
  ),

  http.put(url('/ticket-handling/:class/:id/priority'), async ({ params, request }) => {
    const t = ticket(params.class as HandledClass, String(params.id));
    const { priority, reason } = (await request.json()) as { priority: TicketPriority; reason: string };
    if (!reason?.trim() || reason.trim().length < 3) return bad('Say why the priority is overridden.');
    if (priority === t.priority) return bad(`The priority is already ${LABEL[priority]}.`);
    t.override = {
      from: t.priority,
      to: priority,
      reason: reason.trim(),
      by: currentMockUser().name,
      at: new Date().toISOString(),
      impactFrom: '2',
      urgencyFrom: '3',
      impactTo: '2',
      urgencyTo: '1',
      active: true,
    };
    t.priority = priority;
    return HttpResponse.json(t);
  }),

  http.get(url('/ticket-handling/:class/:id/duplicates/suggestions'), ({ params }) =>
    HttpResponse.json({ items: SEED_CANDIDATES.filter((c) => !(c.class === params.class && String(c.id) === params.id)) }),
  ),

  http.post(url('/ticket-handling/:class/:id/duplicate'), async ({ params, request }) => {
    const cls = params.class as HandledClass;
    const t = ticket(cls, String(params.id));
    const input = (await request.json()) as { originalClass: HandledClass; originalId: number };
    if (cls === 'Incident' && input.originalClass === 'UserRequest') {
      return bad('An incident can only be a duplicate of another incident (iTop has no request parent on incidents).');
    }
    const original = ticket(input.originalClass, input.originalId);
    t.duplicateOf = { class: original.class, id: original.id, ref: original.ref, title: 'The original', status: 'open' };
    original.duplicates = [...original.duplicates, { class: cls, id: t.id, ref: t.ref, title: 'This ticket', status: 'resolved' }];
    closeIt(t);
    return HttpResponse.json(t);
  }),

  http.post(url('/ticket-handling/:class/:id/cancel'), async ({ params, request }) => {
    const t = ticket(params.class as HandledClass, String(params.id));
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim() || reason.trim().length < 3) return bad('Say why the ticket is cancelled.');
    t.cancelled = { reason: reason.trim(), by: currentMockUser().name };
    closeIt(t);
    return HttpResponse.json(t);
  }),

  http.get(url('/ticket-handling/:class/:id/worklogs'), ({ params }) =>
    HttpResponse.json(worklogOf(params.class as HandledClass, Number(params.id))),
  ),

  http.post(url('/ticket-handling/:class/:id/worklogs'), async ({ params, request }) => {
    const cls = params.class as HandledClass;
    const id = Number(params.id);
    const input = (await request.json()) as { minutes: number; note: string; workDate?: string };
    if (!Number.isInteger(input.minutes) || input.minutes < 1) return bad('Time spent is 1 minute to 24 hours per entry.');
    const user = currentMockUser();
    worklogs.push({
      id: nextEntry++,
      class: cls,
      ticketId: id,
      ticketRef: refOf(cls, id),
      agent: { userId: Number(user.id), contactId: 0, name: user.name },
      minutes: input.minutes,
      note: input.note,
      workDate: input.workDate ?? new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    });
    return HttpResponse.json(worklogOf(cls, id), { status: 201 });
  }),

  /* Drafts */

  http.get(url('/me/drafts'), ({ request }) => {
    const kind = new URL(request.url).searchParams.get('kind') as DraftKind | null;
    const items = drafts
      .filter((d) => !kind || d.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, kind: k, title, updatedAt }) => ({ id, kind: k, title, updatedAt }));
    return HttpResponse.json({ items });
  }),

  http.get(url('/me/drafts/:id'), ({ params }) => {
    const d = drafts.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : HttpResponse.json({ error: { code: 'not_found', message: 'That draft was not found.' } }, { status: 404 });
  }),

  http.post(url('/me/drafts'), async ({ request }) => {
    const input = (await request.json()) as { kind: DraftKind; title?: string; data: Record<string, unknown> };
    const now = new Date().toISOString();
    const title = input.title || (typeof input.data['title'] === 'string' && input.data['title']) || 'Untitled draft';
    const draft: Draft = { id: Math.random().toString(16).slice(2).padEnd(24, '0').slice(0, 24), kind: input.kind, title, data: input.data, createdAt: now, updatedAt: now };
    drafts.push(draft);
    return HttpResponse.json(draft, { status: 201 });
  }),

  http.put(url('/me/drafts/:id'), async ({ params, request }) => {
    const d = drafts.find((x) => x.id === params.id);
    if (!d) return HttpResponse.json({ error: { code: 'not_found', message: 'That draft was not found.' } }, { status: 404 });
    const input = (await request.json()) as { title?: string; data: Record<string, unknown> };
    d.data = input.data;
    d.title = input.title || (typeof input.data['title'] === 'string' && input.data['title']) || 'Untitled draft';
    d.updatedAt = new Date().toISOString();
    return HttpResponse.json(d);
  }),

  http.delete(url('/me/drafts/:id'), ({ params }) => {
    drafts = drafts.filter((d) => d.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

/** Puts the mock back as it started (tests). */
export function resetTicketHandlingMock() {
  tickets = new Map();
  worklogs = [];
  drafts = [];
  nextEntry = 1;
}
