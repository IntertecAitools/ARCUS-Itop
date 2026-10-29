import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { IncidentDetail, TransitionAction } from '@/features/incidents';
import { mockFlag } from '../storage';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock incidents.
 *
 * Empty by default, matching an iTop instance with no tickets — the state the
 * empty views are designed against. Flip SEEDED for a populated queue to style
 * or demo against; the browser tests turn it on per tab with the `seeded` flag.
 *
 * The store is mutable so creates, transitions and log entries behave like the
 * real thing: a mock that accepts a write and forgets it hides bugs in the
 * cache-invalidation that follows.
 */
const SEEDED = false;

/** Mirrors the backend's lifecycle, so the mock offers the same actions. */
const ACTIONS_BY_STATUS: Record<string, TransitionAction[]> = {
  new: ['assign', 'dispatch'],
  dispatched: ['assign', 'dispatch'],
  open: ['hold', 'resolve', 'reassign'],
  in_progress: ['hold', 'resolve', 'reassign'],
  pending: ['assign'],
  resolved: ['close', 'reopen'],
  closed: [],
};

const RESULT_STATUS: Record<TransitionAction, IncidentDetail['status']> = {
  assign: 'open',
  dispatch: 'dispatched',
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
    createdAt: '2026-10-06T09:00:00Z',
    sla: { ttoBreached: false, ttrBreached: false },
    log: [],
    availableActions: ACTIONS_BY_STATUS[status] ?? [],
    childIncidents: [],
    extrasAvailable: true,
    major: false,
    ...partial,
  };
}

/** Today on this computer's calendar, as the BFF compares next-action dates. */
const today = () => new Date().toLocaleDateString('en-CA');

/** The detail with its linked incidents and whether its hold is overdue, as the BFF answers. */
function view(incident: IncidentDetail): IncidentDetail {
  const children = store
    .filter((i) => i.parentIncident?.id === incident.id)
    .map(({ id, ref, summary, status }) => ({ id, ref, summary, status }));
  const pending =
    incident.status === 'pending' && incident.pending
      ? {
          ...incident.pending,
          overdue: Boolean(incident.pending.nextActionDate && incident.pending.nextActionDate < today()),
        }
      : undefined;
  const { pending: _stored, ...rest } = incident;
  return { ...rest, ...(pending ? { pending } : {}), childIncidents: children };
}

const badRequest = (message: string) =>
  HttpResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });

const seeded: IncidentDetail[] = [
  make({
    id: '1042',
    ref: 'I-001042',
    summary: 'VPN connection unavailable',
    description: 'Branch office users cannot establish a tunnel.',
    status: 'open',
    priority: 'critical',
    assignee: { id: '1', name: 'admin' },
    createdAt: '2026-10-06T10:42:00Z',
    sla: { ttoBreached: false, ttrBreached: true },
    log: [{ date: '2026-10-06T11:00:00Z', author: 'admin', message: 'Investigating the gateway.' }],
  }),
  make({
    id: '1041',
    ref: 'I-001041',
    summary: 'Email service intermittent',
    status: 'in_progress',
    priority: 'high',
    assignee: { id: '2', name: 'Ravi' },
    createdAt: '2026-10-06T09:15:00Z',
  }),
  make({
    id: '1040',
    ref: 'I-001040',
    summary: 'Laptop not booting',
    status: 'resolved',
    priority: 'medium',
    createdAt: '2026-10-05T16:21:00Z',
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
  return SEEDED || mockFlag('seeded') ? structuredClone(seeded) : [];
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

/** The signed-in agent's open incidents, as the dashboard's My Assignments lists them. */
export function myOpenIncidents() {
  const items = store
    .filter((i) => i.assignee?.id === '1' && !['resolved', 'closed'].includes(i.status))
    .map(view)
    .map(({ id, ref, summary, status, priority, createdAt, pending }) => ({
      id,
      ref,
      summary,
      status,
      priority,
      createdAt,
      ...(pending ? { pending } : {}),
    }));
  return { items, total: items.length };
}

/** Open major incidents, as the dashboard banner shows them. */
export function openMajorIncidents() {
  return store
    .filter((i) => i.major && !['resolved', 'closed'].includes(i.status))
    .map(({ id, ref, summary, status, priority, createdAt }) => ({ id, ref, summary, status, priority, createdAt }));
}

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
        { value: '1', label: 'admin' },
        { value: '2', label: 'Ravi' },
      ],
      teams: [{ value: '7', label: 'Network' }],
      services: [{ value: '3', label: 'Network access' }],
      serviceSubcategories: [{ value: '31', label: 'VPN', serviceId: '3' }],
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
    // `me` is the mock's signed-in agent, the "admin" seeded above.
    const rawAssignee = params.get('assignee');
    const assignee = rawAssignee === 'me' ? '1' : rawAssignee;

    let items = [...store];
    if (assignee === 'unassigned') items = items.filter((i) => !i.assignee);
    else if (assignee) items = items.filter((i) => i.assignee?.id === assignee);
    if (status?.length) items = items.filter((i) => status.includes(i.status));
    if (priority?.length) items = items.filter((i) => priority.includes(i.priority));
    if (q) {
      items = items.filter(
        (i) => i.ref.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q),
      );
    }
    items = items.map(view);
    if (params.get('major') === 'true') items = items.filter((i) => i.major);
    if (params.get('overdue') === 'true') items = items.filter((i) => i.pending?.overdue);

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

  http.get(url('/incidents/major'), () => HttpResponse.json({ items: openMajorIncidents() })),

  http.get(url('/incidents/:id'), ({ params }) => {
    const incident = find(params.id);
    return incident ? HttpResponse.json(view(incident)) : notFound(params.id);
  }),

  http.put(url('/incidents/:id/major'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    const { major } = (await request.json()) as { major: boolean };
    incident.major = major;
    persist();
    return HttpResponse.json(view(incident));
  }),

  http.post(url('/incidents/:id/children'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    const { incidentIds } = (await request.json()) as { incidentIds: string[] };
    if (incidentIds.includes(incident.id)) return badRequest('An incident cannot be linked to itself.');
    for (const childId of incidentIds) {
      const child = find(childId);
      if (!child) return notFound(childId);
      child.parentIncident = { id: incident.id, ref: incident.ref, summary: incident.summary, status: incident.status };
    }
    persist();
    return HttpResponse.json(view(incident));
  }),

  http.delete(url('/incidents/:id/children/:childId'), ({ params }) => {
    const incident = find(params.id);
    const child = find(params.childId);
    if (!incident) return notFound(params.id);
    if (!child || child.parentIncident?.id !== incident.id) return notFound(params.childId);
    delete child.parentIncident;
    persist();
    return HttpResponse.json(view(incident));
  }),

  http.post(url('/incidents/:id/stakeholder-updates'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    if (!incident.major) return badRequest(`${incident.ref} is not a major incident; declare it one first.`);
    const body = (await request.json()) as { message: string; postToChildren?: boolean; notifyEmails?: string[] };
    const date = new Date().toISOString();
    const entry = (message: string) => ({ date, author: 'admin', message });
    incident.log = [...incident.log, entry(`Stakeholder update: ${body.message}`)];
    const children = store.filter((i) => i.parentIncident?.id === incident.id && i.status !== 'closed');
    if (body.postToChildren) {
      for (const child of children) child.log = [...child.log, entry(`${incident.ref} Stakeholder update: ${body.message}`)];
    }
    persist();
    return HttpResponse.json({
      incident: view(incident),
      postedTo: body.postToChildren ? children.length : 0,
      notified: body.notifyEmails ?? [],
    });
  }),

  http.get(url('/tickets/:class/:id/pending'), ({ params }) => {
    const incident = params.class === 'Incident' ? find(params.id) : undefined;
    return HttpResponse.json({ pending: incident ? (view(incident).pending ?? null) : null, extrasAvailable: true });
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
    return HttpResponse.json(view(incident));
  }),

  http.post(url('/incidents/:id/transitions'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);

    const body = (await request.json()) as {
      action: TransitionAction;
      teamId?: string;
      solution?: string;
      pendingReason?: string;
      nextActionDate?: string;
    };

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

    if (body.action === 'hold') {
      if (!body.pendingReason?.trim()) return badRequest('"hold" requires a pending reason.');
      if (!body.nextActionDate) return badRequest('"hold" requires a next-action date.');
      if (body.nextActionDate < today()) return badRequest('The next-action date cannot be in the past.');
      incident.pending = { reason: body.pendingReason.trim(), nextActionDate: body.nextActionDate, overdue: false };
    }

    if (body.action === 'dispatch') {
      if (!body.teamId) return badRequest('"dispatch" requires team_id.');
      incident.team = { id: body.teamId, name: `Team ${body.teamId}` };
    }

    incident.status = RESULT_STATUS[body.action];
    incident.availableActions = ACTIONS_BY_STATUS[incident.status] ?? [];
    if (body.solution) incident.resolution = body.solution;
    persist();
    return HttpResponse.json(view(incident));
  }),

  http.post(url('/incidents/:id/log'), async ({ params, request }) => {
    const incident = find(params.id);
    if (!incident) return notFound(params.id);
    const { message } = (await request.json()) as { message: string };
    incident.log = [
      ...incident.log,
      { date: new Date().toISOString().slice(0, 16).replace('T', ' '), author: 'admin', message },
    ];
    persist();
    return HttpResponse.json(view(incident));
  }),
];
