import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { IncidentDetail, TransitionAction } from '@/features/incidents';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock incidents.
 *
 * Empty by default, matching an iTop instance with no tickets — the state the
 * empty views are designed against. Flip SEEDED for a populated queue to style
 * or demo against.
 *
 * The store is mutable so creates, transitions and log entries behave like the
 * real thing: a mock that accepts a write and forgets it hides bugs in the
 * cache-invalidation that follows.
 */
const SEEDED = false;

/** Mirrors the backend's lifecycle, so the mock offers the same actions. */
const ACTIONS_BY_STATUS: Record<string, TransitionAction[]> = {
  new: ['assign'],
  open: ['hold', 'resolve', 'reassign'],
  in_progress: ['hold', 'resolve', 'reassign'],
  pending: ['assign'],
  resolved: ['close', 'reopen'],
  closed: [],
};

const RESULT_STATUS: Record<TransitionAction, IncidentDetail['status']> = {
  assign: 'open',
  reassign: 'open',
  hold: 'pending',
  resolve: 'resolved',
  close: 'closed',
  reopen: 'open',
};

function make(partial: Partial<IncidentDetail> & { id: string; ref: string }): IncidentDetail {
  const status = partial.status ?? 'open';
  return {
    summary: 'Untitled',
    description: '',
    status,
    priority: 'medium',
    createdAt: '2026-10-06 09:00:00',
    sla: { ttoBreached: false, ttrBreached: false },
    log: [],
    availableActions: ACTIONS_BY_STATUS[status] ?? [],
    ...partial,
  };
}

const seeded: IncidentDetail[] = [
  make({
    id: '1042',
    ref: 'I-001042',
    summary: 'VPN connection unavailable',
    description: 'Branch office users cannot establish a tunnel.',
    status: 'open',
    priority: 'critical',
    assignee: { id: '1', name: 'Vasanth' },
    createdAt: '2026-10-06 10:42:00',
    sla: { ttoBreached: false, ttrBreached: true },
    log: [{ date: '2026-10-06 11:00', author: 'Vasanth', message: 'Investigating the gateway.' }],
  }),
  make({
    id: '1041',
    ref: 'I-001041',
    summary: 'Email service intermittent',
    status: 'in_progress',
    priority: 'high',
    assignee: { id: '2', name: 'Ravi' },
    createdAt: '2026-10-06 09:15:00',
  }),
  make({
    id: '1040',
    ref: 'I-001040',
    summary: 'Laptop not booting',
    status: 'resolved',
    priority: 'medium',
    createdAt: '2026-10-05 16:21:00',
  }),
];

/**
 * Persisted to sessionStorage so the mock behaves like a real server: a write
 * survives a page reload. Module state alone would reset on every navigation,
 * which would make the UI look like it silently lost data.
 *
 * sessionStorage is per-tab, so parallel tests stay isolated from each other.
 */
const STORAGE_KEY = 'arcus.mock.incidents';

function load(): IncidentDetail[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as IncidentDetail[];
  } catch {
    // A quota error or disabled storage must not break the mock.
  }
  return SEEDED ? [...seeded] : [];
}

let store: IncidentDetail[] = load();

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore: the in-memory copy still serves this page.
  }
}

/** Ids must not collide with anything already stored across a reload. */
let nextId = Math.max(2000, ...store.map((i) => Number(i.id) || 0)) + 1;

const find = (id: unknown) => store.find((i) => i.id === String(id));

const notFound = (id: unknown) =>
  HttpResponse.json(
    { error: { code: 'not_found', message: `Incident ${id} was not found.` } },
    { status: 404 },
  );

const options = (values: string[]) =>
  values.map((v) => ({ value: v, label: v.replace(/^./, (c) => c.toUpperCase()) }));

export const incidentHandlers = [
  http.get(url('/incidents/options'), () =>
    HttpResponse.json({
      priorities: options(['critical', 'high', 'medium', 'low']),
      urgencies: [
        { value: '1', label: 'Critical' },
        { value: '2', label: 'High' },
        { value: '3', label: 'Medium' },
        { value: '4', label: 'Low' },
      ],
      impacts: [
        { value: '1', label: 'A department' },
        { value: '2', label: 'A service' },
        { value: '3', label: 'A person' },
      ],
      origins: options(['phone', 'mail', 'portal', 'chat', 'monitoring']),
      resolutionCodes: options(['assistance', 'training', 'other']),
      organizations: [{ value: '1', label: 'My Company/Department' }],
      agents: [
        { value: '1', label: 'Vasanth' },
        { value: '2', label: 'Ravi' },
      ],
      teams: [],
      services: [],
    }),
  ),

  http.get(url('/incidents'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit')) || 25;
    const page = Number(params.get('page')) || 1;

    // Filtering is applied for real so the mock exercises the same code paths
    // the live BFF would — a mock that ignores filters hides bugs in them.
    const status = params.get('status')?.split(',').filter(Boolean);
    const priority = params.get('priority')?.split(',').filter(Boolean);
    const q = params.get('q')?.toLowerCase();

    let items = [...store];
    if (status?.length) items = items.filter((i) => status.includes(i.status));
    if (priority?.length) items = items.filter((i) => priority.includes(i.priority));
    if (q) {
      items = items.filter(
        (i) => i.ref.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q),
      );
    }

    const total = items.length;
    return HttpResponse.json({
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
    });
  }),

  http.get(url('/incidents/:id'), ({ params }) => {
    const incident = find(params.id);
    return incident ? HttpResponse.json(incident) : notFound(params.id);
  }),

  http.post(url('/incidents'), async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    const id = String(nextId++);
    const created = make({
      id,
      ref: `I-00${id}`,
      summary: body.title,
      description: body.description,
      status: 'new',
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    store = [created, ...store];
    persist();
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(url('/incidents/:id'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    const body = (await request.json()) as Record<string, string>;
    Object.assign(incident, body.title ? { summary: body.title } : {});
    persist();
    return HttpResponse.json(incident);
  }),

  http.post(url('/incidents/:id/transitions'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);

    const body = (await request.json()) as { action: TransitionAction; solution?: string };

    // Reject an illegal transition exactly as the backend does, so the UI's
    // error path is exercised rather than assumed.
    if (!incident.availableActions.includes(body.action)) {
      return HttpResponse.json(
        {
          error: {
            code: 'bad_request',
            message: `"${body.action}" is not available for an incident that is ${incident.status}.`,
          },
        },
        { status: 400 },
      );
    }

    incident.status = RESULT_STATUS[body.action];
    incident.availableActions = ACTIONS_BY_STATUS[incident.status] ?? [];
    if (body.solution) incident.resolution = body.solution;
    persist();
    return HttpResponse.json(incident);
  }),

  http.post(url('/incidents/:id/log'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    const { message } = (await request.json()) as { message: string };
    incident.log = [
      ...incident.log,
      { date: new Date().toISOString().slice(0, 16).replace('T', ' '), author: 'Vasanth', message },
    ];
    persist();
    return HttpResponse.json(incident);
  }),
];
