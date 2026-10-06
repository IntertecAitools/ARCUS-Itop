/**
 * Fake BFF for Problems. Behaves like iTop: status changes only via stimuli,
 * priority computed from impact × urgency, field flags enforced per state.
 */
import { HttpResponse, http } from 'msw';
import type { CurrentUser } from '@/types';
import { getDb, saveDb } from '../fixtures/db';
import { changes, cis, orgs, persons, services, teams } from '../fixtures/reference';
import { PRIORITY, type ProblemRecord, type Status, type TicketRecord } from '../fixtures/seed';
import {
  api,
  error,
  latency,
  matchesQuery,
  notFound,
  paginate,
  personName,
  requireWriter,
  textToHtml,
} from './utils';

type Field =
  | 'org_id'
  | 'caller_id'
  | 'title'
  | 'description'
  | 'service_id'
  | 'servicesubcategory_id'
  | 'product'
  | 'impact'
  | 'urgency'
  | 'team_id'
  | 'agent_id'
  | 'related_change_id';
type Flag = 'hidden' | 'readonly' | 'optional' | 'mandatory';

// ─── iTop lifecycle (server side) ────────────────────────────────────────────

const FLAGS: Record<Status, Partial<Record<Field, Flag>>> = {
  new: { org_id: 'mandatory', title: 'mandatory', description: 'mandatory', impact: 'mandatory', urgency: 'mandatory', team_id: 'hidden', agent_id: 'hidden' },
  assigned: { org_id: 'mandatory', title: 'mandatory', description: 'mandatory', impact: 'mandatory', urgency: 'mandatory', team_id: 'mandatory', agent_id: 'mandatory' },
  resolved: {
    org_id: 'readonly',
    caller_id: 'readonly',
    title: 'readonly',
    description: 'readonly',
    impact: 'readonly',
    urgency: 'readonly',
    team_id: 'readonly',
    agent_id: 'readonly',
    service_id: 'mandatory',
  },
  closed: {
    org_id: 'readonly',
    caller_id: 'readonly',
    title: 'readonly',
    description: 'readonly',
    impact: 'readonly',
    urgency: 'readonly',
    team_id: 'readonly',
    agent_id: 'readonly',
    service_id: 'readonly',
    servicesubcategory_id: 'readonly',
    product: 'readonly',
    related_change_id: 'readonly',
  },
};
const flag = (status: Status, field: Field): Flag => FLAGS[status][field] ?? 'optional';

type Stimulus = 'ev_assign' | 'ev_reassign' | 'ev_resolve' | 'ev_close';
const LIFECYCLE: Record<Status, Array<{ stimulus: Stimulus; target: Status }>> = {
  new: [{ stimulus: 'ev_assign', target: 'assigned' }],
  assigned: [
    { stimulus: 'ev_reassign', target: 'assigned' },
    { stimulus: 'ev_resolve', target: 'resolved' },
  ],
  resolved: [
    { stimulus: 'ev_reassign', target: 'assigned' },
    { stimulus: 'ev_close', target: 'closed' },
  ],
  closed: [],
};
const STIMULUS_FIELDS: Record<Stimulus, { required: Field[]; prompted: Field[] }> = {
  ev_assign: { required: ['team_id', 'agent_id'], prompted: [] },
  ev_reassign: { required: ['team_id', 'agent_id'], prompted: [] },
  ev_resolve: { required: ['service_id'], prompted: ['servicesubcategory_id', 'product'] },
  ev_close: { required: [], prompted: [] },
};

const LABELS: Record<Field, string> = {
  org_id: 'Organization',
  caller_id: 'Caller',
  title: 'Title',
  description: 'Description',
  service_id: 'Service',
  servicesubcategory_id: 'Service subcategory',
  product: 'Product',
  impact: 'Impact',
  urgency: 'Urgency',
  team_id: 'Team',
  agent_id: 'Agent',
  related_change_id: 'Related change',
};

// ─── DTO mapping ─────────────────────────────────────────────────────────────

const orgName = (id: string | null) => (id ? (orgs.find((o) => o.id === id)?.name ?? null) : null);
const teamName = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? null) : null);
const serviceName = (id: string | null) => (id ? (services.find((s) => s.id === id)?.name ?? null) : null);
const subcategoryName = (id: string | null) =>
  id ? (services.flatMap((s) => s.subcategories).find((sc) => sc.id === id)?.name ?? null) : null;

function toSummary(p: ProblemRecord) {
  return {
    id: p.id,
    ref: p.ref,
    title: p.title,
    status: p.status,
    priority: p.priority,
    impact: p.impact,
    urgency: p.urgency,
    org_id: p.org_id,
    org_name: orgName(p.org_id) ?? '',
    caller_id: p.caller_id,
    caller_name: personName(p.caller_id),
    team_id: p.team_id,
    team_name: teamName(p.team_id),
    agent_id: p.agent_id,
    agent_name: personName(p.agent_id),
    service_id: p.service_id,
    service_name: serviceName(p.service_id),
    start_date: p.start_date,
    last_update: p.last_update,
  };
}

function toLinkedTicket(t: TicketRecord) {
  return {
    id: t.id,
    ref: t.ref,
    title: t.title,
    status: t.status,
    priority: t.priority,
    start_date: t.start_date,
    org_name: orgName(t.org_id) ?? undefined,
  };
}

export function toKnownErrorSummary(ke: ReturnType<typeof getDb>['knownErrors'][number]) {
  const problem = ke.problem_id ? getDb().problems.find((p) => p.id === ke.problem_id) : null;
  return {
    id: ke.id,
    name: ke.name,
    org_id: ke.org_id,
    org_name: orgName(ke.org_id) ?? '',
    problem_id: ke.problem_id,
    problem_ref: problem?.ref ?? null,
    error_code: ke.error_code,
    domain: ke.domain,
    vendor: ke.vendor,
    model: ke.model,
    version: ke.version,
  };
}

function toDetail(p: ProblemRecord) {
  const db = getDb();
  return {
    ...toSummary(p),
    description: p.description,
    close_date: p.close_date,
    assignment_date: p.assignment_date,
    resolution_date: p.resolution_date,
    servicesubcategory_id: p.servicesubcategory_id,
    servicesubcategory_name: subcategoryName(p.servicesubcategory_id),
    product: p.product,
    related_change_id: p.related_change_id,
    related_change_ref: p.related_change_id ? (changes.find((c) => c.id === p.related_change_id)?.ref ?? null) : null,
    private_log: p.private_log,
    functionalcis_list: p.cis.map((l) => {
      const ci = cis.find((c) => c.id === l.functionalci_id);
      return {
        functionalci_id: l.functionalci_id,
        functionalci_name: ci?.name ?? l.functionalci_id,
        functionalci_class: ci?.finalclass ?? 'FunctionalCI',
        impact_code: l.impact_code,
      };
    }),
    contacts_list: p.contacts.map((l) => {
      const person = persons.find((x) => x.id === l.contact_id);
      return {
        contact_id: l.contact_id,
        contact_name: person?.name ?? l.contact_id,
        contact_email: person?.email,
        role_code: l.role_code,
      };
    }),
    knownerrors_list: db.knownErrors.filter((ke) => ke.problem_id === p.id).map(toKnownErrorSummary),
    related_incident_list: db.incidents.filter((i) => i.parent_problem_id === p.id).map(toLinkedTicket),
    related_request_list: db.requests.filter((r) => r.parent_problem_id === p.id).map(toLinkedTicket),
  };
}

// ─── Validation helpers ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();
const empty = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() === '');

/** Check a value references an existing object. Returns an error message or null. */
function checkReference(field: Field, value: unknown, record: Pick<ProblemRecord, 'org_id' | 'team_id' | 'service_id'>): string | null {
  if (empty(value)) return null;
  const v = String(value);
  switch (field) {
    case 'org_id':
      return orgs.some((o) => o.id === v) ? null : 'Unknown organization.';
    case 'caller_id': {
      const person = persons.find((p) => p.id === v);
      return person && person.org_id === record.org_id ? null : 'The caller must belong to the organization.';
    }
    case 'team_id':
      return teams.some((t) => t.id === v) ? null : 'Unknown team.';
    case 'agent_id': {
      const team = teams.find((t) => t.id === record.team_id);
      return team?.members.includes(v) ? null : 'The agent must be a member of the team.';
    }
    case 'service_id':
      return services.some((s) => s.id === v) ? null : 'Unknown service.';
    case 'servicesubcategory_id': {
      const service = services.find((s) => s.id === record.service_id);
      return service?.subcategories.some((sc) => sc.id === v) ? null : 'The subcategory does not belong to the service.';
    }
    case 'impact':
      return ['1', '2', '3'].includes(v) ? null : 'Invalid impact.';
    case 'urgency':
      return ['1', '2', '3', '4'].includes(v) ? null : 'Invalid urgency.';
    default:
      return null;
  }
}

function addLog(p: ProblemRecord, user: CurrentUser, html: string) {
  p.private_log.push({ date: now(), user_login: user.login, user_name: user.name, message_html: html });
}

function findProblem(id: string) {
  return getDb().problems.find((p) => p.id === id);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

function stats(range: '7d' | '30d' | '90d') {
  const db = getDb();
  const t = Date.now();
  const weekAgo = t - 7 * DAY;
  const twoWeeksAgo = t - 14 * DAY;
  const ts = (s: string | null) => (s ? new Date(s).getTime() : null);
  const ps = db.problems;

  const openAt = (at: number) =>
    ps.filter((p) => ts(p.start_date)! <= at && (ts(p.resolution_date) === null || ts(p.resolution_date)! > at)).length;
  const unassignedAt = (at: number) =>
    ps.filter((p) => ts(p.start_date)! <= at && (ts(p.assignment_date) === null || ts(p.assignment_date)! > at)).length;
  const resolvedBetween = (from: number, to: number) =>
    ps.filter((p) => {
      const r = ts(p.resolution_date);
      return r !== null && r > from && r <= to;
    }).length;

  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const bucket = range === '90d' ? 7 : 1;
  const start = new Date(t - (days - 1) * DAY);
  start.setHours(0, 0, 0, 0);
  const series: Array<{ date: string; created: number; resolved: number }> = [];
  for (let s = start.getTime(); s <= t; s += bucket * DAY) {
    const e = s + bucket * DAY;
    series.push({
      date: new Date(s).toISOString(),
      created: ps.filter((p) => ts(p.start_date)! >= s && ts(p.start_date)! < e).length,
      resolved: ps.filter((p) => {
        const r = ts(p.resolution_date);
        return r !== null && r >= s && r < e;
      }).length,
    });
  }

  const inRange = ps.filter((p) => ts(p.start_date)! >= start.getTime());
  const byPriority = (['1', '2', '3', '4'] as const).map((priority) => ({
    priority,
    count: inRange.filter((p) => p.priority === priority).length,
  }));
  const serviceCounts = new Map<string, number>();
  for (const p of inRange) if (p.service_id) serviceCounts.set(p.service_id, (serviceCounts.get(p.service_id) ?? 0) + 1);
  const topServices = [...serviceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ service_id: id, service_name: serviceName(id) ?? id, count }));

  return {
    range,
    kpis: {
      open: { value: ps.filter((p) => p.status === 'new' || p.status === 'assigned').length, previous: openAt(weekAgo) },
      unassigned: { value: ps.filter((p) => p.status === 'new').length, previous: unassignedAt(weekAgo) },
      resolvedThisWeek: { value: resolvedBetween(weekAgo, t), previous: resolvedBetween(twoWeeksAgo, weekAgo) },
      knownErrors: {
        value: db.knownErrors.length,
        previous: db.knownErrors.filter((k) => ts(k.created)! <= weekAgo).length,
      },
    },
    series,
    byPriority,
    topServices,
  };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const SORTABLE = new Set([
  'ref',
  'title',
  'org_name',
  'service_name',
  'priority',
  'status',
  'team_name',
  'agent_name',
  'start_date',
  'last_update',
]);
const STATUS_ORDER: Record<Status, number> = { new: 0, assigned: 1, resolved: 2, closed: 3 };

export const problemsHandlers = [
  http.get(api('/problems'), async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const p = url.searchParams;
    const list = (key: string) => (p.get(key) ? p.get(key)!.split(',') : []);
    const status = list('status');
    const priority = list('priority');
    const impact = list('impact');
    const urgency = list('urgency');
    const from = p.get('from');
    const to = p.get('to');
    const q = p.get('q');

    let rows = getDb()
      .problems.filter(
        (x) =>
          (!status.length || status.includes(x.status)) &&
          (!priority.length || priority.includes(x.priority)) &&
          (!impact.length || impact.includes(x.impact)) &&
          (!urgency.length || urgency.includes(x.urgency)) &&
          (!p.get('orgId') || x.org_id === p.get('orgId')) &&
          (!p.get('teamId') || x.team_id === p.get('teamId')) &&
          (!p.get('agentId') || x.agent_id === p.get('agentId')) &&
          (!p.get('serviceId') || x.service_id === p.get('serviceId')) &&
          (!from || x.start_date.slice(0, 10) >= from) &&
          (!to || x.start_date.slice(0, 10) <= to) &&
          matchesQuery(q, x.ref, x.title, x.description.replace(/<[^>]*>/g, ' '), x.product),
      )
      .map(toSummary);

    const sort = p.get('sort') ?? '-start_date';
    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;
    if (SORTABLE.has(key)) {
      rows = rows.sort((a, b) => {
        const av = key === 'status' ? STATUS_ORDER[a.status] : (a[key as keyof typeof a] ?? '');
        const bv = key === 'status' ? STATUS_ORDER[b.status] : (b[key as keyof typeof b] ?? '');
        const cmp = av < bv ? -1 : av > bv ? 1 : a.ref.localeCompare(b.ref);
        return desc ? -cmp : cmp;
      });
    }
    return HttpResponse.json(paginate(rows, url));
  }),

  http.get(api('/problems/stats'), async ({ request }) => {
    await latency();
    const range = new URL(request.url).searchParams.get('range');
    return HttpResponse.json(stats(range === '30d' || range === '90d' ? range : '7d'));
  }),

  http.get(api('/problems/:id'), async ({ params }) => {
    await latency();
    const problem = findProblem(String(params.id));
    return problem ? HttpResponse.json(toDetail(problem)) : notFound('Problem', String(params.id));
  }),

  // core/create
  http.post(api('/problems'), async ({ request }) => {
    await latency();
    const { user, denied } = requireWriter(request);
    if (denied) return denied;
    const body = (await request.json()) as Record<string, unknown>;
    if ('status' in body || 'priority' in body) return error(400, 'read_only', 'status and priority cannot be written.');

    for (const field of ['org_id', 'title', 'description', 'impact', 'urgency'] as Field[]) {
      if (empty(body[field])) return error(400, 'missing_field', `${LABELS[field]} is mandatory.`);
    }
    const draft = {
      org_id: String(body.org_id),
      team_id: null,
      service_id: (body.service_id as string | null) ?? null,
    };
    for (const field of ['org_id', 'caller_id', 'service_id', 'servicesubcategory_id', 'impact', 'urgency'] as Field[]) {
      const message = checkReference(field, body[field], draft);
      if (message) return error(400, 'invalid_value', `${LABELS[field]}: ${message}`);
    }

    const db = getDb();
    db.seq.problem += 1;
    const id = String(db.seq.problem);
    const impact = String(body.impact) as ProblemRecord['impact'];
    const urgency = String(body.urgency) as ProblemRecord['urgency'];
    const record: ProblemRecord = {
      id,
      ref: `P-${String(122 + db.seq.problem).padStart(6, '0')}`,
      title: String(body.title).trim(),
      description: String(body.description),
      org_id: String(body.org_id),
      caller_id: (body.caller_id as string | null) || null,
      team_id: null,
      agent_id: null,
      status: 'new',
      service_id: (body.service_id as string | null) || null,
      servicesubcategory_id: (body.servicesubcategory_id as string | null) || null,
      product: String(body.product ?? ''),
      impact,
      urgency,
      priority: PRIORITY[impact]![urgency]!,
      related_change_id: null,
      start_date: now(),
      last_update: now(),
      assignment_date: null,
      resolution_date: null,
      close_date: null,
      private_log: [],
      cis: ((body.functionalcis_list as Array<{ functionalci_id: string }>) ?? [])
        .filter((l) => cis.some((c) => c.id === l.functionalci_id))
        .map((l) => ({ functionalci_id: l.functionalci_id, impact_code: 'manual' as const })),
      contacts: ((body.contacts_list as Array<{ contact_id: string }>) ?? [])
        .filter((l) => persons.some((x) => x.id === l.contact_id))
        .map((l) => ({ contact_id: l.contact_id, role_code: 'manual' as const })),
    };
    db.problems.push(record);
    for (const incidentId of (body.related_incident_ids as string[]) ?? []) {
      const incident = db.incidents.find((i) => i.id === incidentId);
      if (incident) incident.parent_problem_id = id;
    }
    addLog(record, user!, '<p>Problem created.</p>');
    saveDb();
    return HttpResponse.json(toDetail(record), { status: 201 });
  }),

  // core/update: writable fields only
  http.patch(api('/problems/:id'), async ({ params, request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    const body = (await request.json()) as Partial<Record<Field | 'status' | 'priority', string | null>>;
    if ('status' in body) return error(400, 'read_only', 'The status changes only through a lifecycle transition.');
    if ('priority' in body) return error(400, 'read_only', 'The priority is computed from impact and urgency.');

    const next = { ...problem };
    for (const [key, value] of Object.entries(body) as Array<[Field, string | null]>) {
      if (!(key in LABELS)) return error(400, 'unknown_field', `Unknown attribute ${key}.`);
      const f = flag(problem.status, key);
      if (f === 'readonly' || f === 'hidden') return error(400, 'read_only', `${LABELS[key]} cannot be changed in state ${problem.status}.`);
      if (f === 'mandatory' && empty(value)) return error(400, 'missing_field', `${LABELS[key]} is mandatory.`);
      (next as Record<string, unknown>)[key] = value;
    }
    for (const key of Object.keys(body) as Field[]) {
      const message = checkReference(key, next[key as keyof ProblemRecord], next);
      if (message) return error(400, 'invalid_value', `${LABELS[key]}: ${message}`);
    }
    next.priority = PRIORITY[next.impact]![next.urgency]!;
    next.last_update = now();
    Object.assign(problem, next);
    saveDb();
    return HttpResponse.json(toDetail(problem));
  }),

  http.get(api('/problems/:id/transitions'), async ({ params }) => {
    await latency();
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    return HttpResponse.json(LIFECYCLE[problem.status].map((t) => ({ ...t, ...STIMULUS_FIELDS[t.stimulus] })));
  }),

  // core/apply_stimulus
  http.post(api('/problems/:id/transitions/:stimulus'), async ({ params, request }) => {
    await latency();
    const { user, denied } = requireWriter(request);
    if (denied) return denied;
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    const transition = LIFECYCLE[problem.status].find((t) => t.stimulus === params.stimulus);
    if (!transition) {
      return error(400, 'invalid_stimulus', `${String(params.stimulus)} is not allowed in state ${problem.status}.`);
    }
    const body = (await request.json()) as { fields?: Partial<Record<Field, string | null>>; note?: string };
    const { required, prompted } = STIMULUS_FIELDS[transition.stimulus];
    const next = { ...problem };
    for (const field of [...required, ...prompted]) {
      if (body.fields && field in body.fields) (next as Record<string, unknown>)[field] = body.fields[field] ?? null;
    }
    for (const field of required) {
      if (empty(next[field as keyof ProblemRecord])) return error(400, 'missing_field', `${LABELS[field]} is mandatory.`);
    }
    for (const field of [...required, ...prompted]) {
      const message = checkReference(field, next[field as keyof ProblemRecord], next);
      if (message) return error(400, 'invalid_value', `${LABELS[field]}: ${message}`);
    }

    const at = now();
    next.status = transition.target;
    next.last_update = at;
    if (transition.stimulus === 'ev_assign' || transition.stimulus === 'ev_reassign') next.assignment_date = at;
    if (transition.stimulus === 'ev_reassign') next.resolution_date = null;
    if (transition.stimulus === 'ev_resolve') next.resolution_date = at;
    if (transition.stimulus === 'ev_close') next.close_date = at;
    Object.assign(problem, next);
    if (body.note?.trim()) addLog(problem, user!, textToHtml(body.note.trim()));
    saveDb();
    return HttpResponse.json(toDetail(problem));
  }),

  // private_log: add_item
  http.post(api('/problems/:id/log'), async ({ params, request }) => {
    await latency();
    const { user, denied } = requireWriter(request);
    if (denied) return denied;
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    if (problem.status === 'closed') return error(400, 'read_only', 'The case log of a closed problem is read-only.');
    const { message } = (await request.json()) as { message?: string };
    if (empty(message)) return error(400, 'missing_field', 'The message is empty.');
    addLog(problem, user!, String(message));
    problem.last_update = now();
    saveDb();
    return HttpResponse.json(toDetail(problem));
  }),

  // Linked Incidents / UserRequests (parent_problem_id), CIs and contacts
  ...(['incidents', 'requests', 'cis', 'contacts'] as const).flatMap((kind) => [
    http.get(api(`/problems/:id/${kind}`), async ({ params }) => {
      await latency();
      const problem = findProblem(String(params.id));
      if (!problem) return notFound('Problem', String(params.id));
      const detail = toDetail(problem);
      const lists = {
        incidents: detail.related_incident_list,
        requests: detail.related_request_list,
        cis: detail.functionalcis_list,
        contacts: detail.contacts_list,
      };
      return HttpResponse.json(lists[kind]);
    }),

    http.post(api(`/problems/:id/${kind}`), async ({ params, request }) => {
      await latency();
      const { denied } = requireWriter(request);
      if (denied) return denied;
      const problem = findProblem(String(params.id));
      if (!problem) return notFound('Problem', String(params.id));
      if (problem.status === 'closed') return error(400, 'read_only', 'A closed problem cannot be modified.');
      const { id } = (await request.json()) as { id?: string };
      const db = getDb();
      if (kind === 'incidents' || kind === 'requests') {
        const ticket = (kind === 'incidents' ? db.incidents : db.requests).find((t) => t.id === id);
        if (!ticket) return notFound(kind === 'incidents' ? 'Incident' : 'User request', String(id));
        ticket.parent_problem_id = problem.id;
      } else if (kind === 'cis') {
        if (!cis.some((c) => c.id === id)) return notFound('CI', String(id));
        if (!problem.cis.some((l) => l.functionalci_id === id)) problem.cis.push({ functionalci_id: id!, impact_code: 'manual' });
      } else {
        if (!persons.some((x) => x.id === id)) return notFound('Contact', String(id));
        if (!problem.contacts.some((l) => l.contact_id === id)) problem.contacts.push({ contact_id: id!, role_code: 'manual' });
      }
      problem.last_update = now();
      saveDb();
      return new HttpResponse(null, { status: 204 });
    }),

    http.delete(api(`/problems/:id/${kind}/:targetId`), async ({ params, request }) => {
      await latency();
      const { denied } = requireWriter(request);
      if (denied) return denied;
      const problem = findProblem(String(params.id));
      if (!problem) return notFound('Problem', String(params.id));
      if (problem.status === 'closed') return error(400, 'read_only', 'A closed problem cannot be modified.');
      const targetId = String(params.targetId);
      const db = getDb();
      if (kind === 'incidents' || kind === 'requests') {
        const ticket = (kind === 'incidents' ? db.incidents : db.requests).find(
          (t) => t.id === targetId && t.parent_problem_id === problem.id,
        );
        if (ticket) ticket.parent_problem_id = null;
      } else if (kind === 'cis') {
        problem.cis = problem.cis.filter((l) => l.functionalci_id !== targetId);
      } else {
        problem.contacts = problem.contacts.filter((l) => l.contact_id !== targetId);
      }
      problem.last_update = now();
      saveDb();
      return new HttpResponse(null, { status: 204 });
    }),
  ]),

  http.put(api('/problems/:id/change'), async ({ params, request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    if (flag(problem.status, 'related_change_id') === 'readonly') {
      return error(400, 'read_only', 'The related change cannot be changed once the problem is closed.');
    }
    const { changeId } = (await request.json()) as { changeId: string | null };
    if (changeId) {
      const change = changes.find((c) => c.id === changeId);
      if (!change) return notFound('Change', changeId);
      if (change.status === 'closed') return error(400, 'invalid_value', 'Only changes that are not closed can be related.');
    }
    problem.related_change_id = changeId;
    problem.last_update = now();
    saveDb();
    return HttpResponse.json(toDetail(problem));
  }),

  // Attachments (item_class = Problem)
  http.get(api('/problems/:id/attachments'), async ({ params }) => {
    await latency();
    return HttpResponse.json(
      getDb()
        .attachments.filter((a) => a.problem_id === params.id)
        .map(({ id, filename, mimetype, size, creation_date }) => ({ id, filename, mimetype, size, creation_date })),
    );
  }),

  http.get(api('/problems/:id/attachments/:attId'), async ({ params }) => {
    await latency();
    const att = getDb().attachments.find((a) => a.problem_id === params.id && a.id === params.attId);
    if (!att) return notFound('Attachment', String(params.attId));
    return HttpResponse.json({ filename: att.filename, mimetype: att.mimetype, data: att.data });
  }),

  http.post(api('/problems/:id/attachments'), async ({ params, request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const problem = findProblem(String(params.id));
    if (!problem) return notFound('Problem', String(params.id));
    if (problem.status === 'closed') return error(400, 'read_only', 'A closed problem cannot be modified.');
    const body = (await request.json()) as { filename?: string; mimetype?: string; data?: string };
    if (!body.filename || !body.data) return error(400, 'missing_field', 'filename and data are mandatory.');
    const db = getDb();
    db.seq.attachment += 1;
    const record = {
      id: String(db.seq.attachment),
      problem_id: problem.id,
      filename: body.filename,
      mimetype: body.mimetype || 'application/octet-stream',
      data: body.data,
      size: Math.floor((body.data.length * 3) / 4),
      creation_date: now(),
    };
    db.attachments.push(record);
    saveDb();
    const { id, filename, mimetype, size, creation_date } = record;
    return HttpResponse.json({ id, filename, mimetype, size, creation_date }, { status: 201 });
  }),

  http.delete(api('/problems/:id/attachments/:attId'), async ({ params, request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const db = getDb();
    const before = db.attachments.length;
    db.attachments = db.attachments.filter((a) => !(a.problem_id === params.id && a.id === params.attId));
    if (db.attachments.length === before) return notFound('Attachment', String(params.attId));
    saveDb();
    return new HttpResponse(null, { status: 204 });
  }),
];
