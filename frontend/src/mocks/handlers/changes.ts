import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  Blackout,
  BlackoutInput,
  CabDecisionInput,
  CalendarChange,
  ChangeCalendar,
  ChangePir,
  PirDueItem,
  PirInput,
  PirQueue,
  RiskAssessment,
  RiskModel,
  RiskModelDto,
  CabQueue,
  ChangeGovernance,
  ChangePlans,
  ChangeType,
  PlanKind,
  PlanRules,
  PlanRulesDto,
} from '@/features/changes';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock change management, mirroring the BFF's rules: plans per change type,
 * CAB decisions that approve, not approve or defer, the queue of changes
 * awaiting the CAB, and the administrator's plan rules.
 *
 * Change 999 answers as an iTop without the arcus-change-cab extension;
 * change 77 is a routine change; every other id is a planned normal change.
 */
const WITHOUT_EXTENSION = '999';
const ROUTINE = '77';
const KINDS: PlanKind[] = ['implementation', 'rollback', 'test'];

const DEFAULTS: PlanRules = {
  routine: { implementation: 'plan', rollback: 'optional', test: 'optional' },
  normal: { implementation: 'plan', rollback: 'plan', test: 'plan' },
  emergency: { implementation: 'plan', rollback: 'plan', test: 'plan' },
};
let rules: PlanRulesDto = { rules: structuredClone(DEFAULTS), defaults: DEFAULTS, updatedAt: '', updatedBy: '' };

const changes = new Map<string, ChangeGovernance>();
let nextDecision = 1;

function withMissing(g: ChangeGovernance): ChangeGovernance {
  const rule = rules.rules[g.type];
  const missing = (gate: 'plan' | 'implement') =>
    KINDS.filter((k) => (rule[k] === 'plan' || (gate === 'implement' && rule[k] === 'implement')) && !g.plans[k].trim())
      .filter((k) => g.available || k === 'rollback');
  return { ...g, requirements: { ...rule }, missing: { plan: missing('plan'), implement: missing('implement') } };
}

function changeOf(id: string): ChangeGovernance {
  let g = changes.get(id);
  if (!g) {
    const type: ChangeType = id === ROUTINE ? 'routine' : 'normal';
    const cab = type !== 'routine';
    g = {
      changeId: id,
      ref: `C-${id.padStart(6, '0')}`,
      title: cab ? 'Upgrade the mail relay' : 'Monthly patching of print servers',
      type,
      status: cab ? 'planned' : 'assigned',
      available: id !== WITHOUT_EXTENSION,
      plans: { implementation: '', rollback: '', test: '' },
      requirements: rules.rules[type],
      missing: { plan: [], implement: [] },
      cab: { required: cab, awaiting: cab, canDecide: cab && id !== WITHOUT_EXTENSION, decisions: [] },
    };
    changes.set(id, g);
  }
  return withMissing(g);
}

const refused = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

export const changeHandlers = [
  http.get(url('/changes/cab'), () => {
    const items = [...new Set(['12', '13', ...changes.keys()])]
      .map(changeOf)
      .filter((g) => g.cab.awaiting)
      .map((g) => ({
        id: g.changeId,
        ref: g.ref,
        title: g.title,
        type: g.type,
        organization: 'Demo',
        startDate: '2026-11-02T19:00:00.000Z',
        endDate: '2026-11-02T21:00:00.000Z',
        outage: g.changeId === '12',
        impact: 'Mail delayed for 10 minutes',
        ...(g.cab.decisions[0]
          ? { lastDecision: { decision: g.cab.decisions[0].decision, meetingDate: g.cab.decisions[0].meetingDate } }
          : {}),
        missingPlans: g.missing.implement,
      }));
    return HttpResponse.json<CabQueue>({ items, available: true });
  }),

  http.get(url('/changes/:id/governance'), ({ params }) => HttpResponse.json(changeOf(String(params.id)))),

  http.put(url('/changes/:id/plans'), async ({ params, request }) => {
    const id = String(params.id);
    const g = changeOf(id);
    const body = (await request.json()) as Partial<ChangePlans>;
    if (!g.available && (body.implementation !== undefined || body.test !== undefined)) {
      return refused(409, 'conflict', 'This iTop has no implementation or test plans: install the arcus-change-cab extension.');
    }
    const plans = { ...g.plans };
    for (const k of KINDS) {
      const value = body[k];
      if (value !== undefined) plans[k] = value.trim();
    }
    changes.set(id, { ...g, plans });
    return HttpResponse.json(changeOf(id));
  }),

  http.post(url('/changes/:id/cab-decisions'), async ({ params, request }) => {
    const id = String(params.id);
    const g = changeOf(id);
    const body = (await request.json()) as CabDecisionInput;
    if (!g.cab.awaiting) return refused(409, 'conflict', 'Only a planned change waits for the CAB.');
    if (body.decision === 'rejected' && !body.notes.trim()) {
      return refused(400, 'bad_request', 'Say why the CAB rejected the change (notes).');
    }
    const decision = {
      id: String(nextDecision++),
      meetingDate: body.meetingDate,
      attendees: body.attendees,
      decision: body.decision,
      conditions: body.conditions,
      notes: body.notes,
      recordedBy: 'Agent Demo',
      recordedAt: new Date().toISOString(),
    };
    const status =
      body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'not_approved' : g.status;
    const awaiting = status === 'planned';
    changes.set(id, {
      ...g,
      status,
      cab: { ...g.cab, awaiting, canDecide: awaiting, decisions: [decision, ...g.cab.decisions] },
    });
    return HttpResponse.json(changeOf(id), { status: 201 });
  }),

  http.get(url('/admin/change-rules'), () => HttpResponse.json(rules)),

  http.put(url('/admin/change-rules'), async ({ request }) => {
    const body = (await request.json()) as { rules: PlanRules };
    rules = { ...rules, rules: body.rules, updatedAt: new Date().toISOString(), updatedBy: 'admin' };
    return HttpResponse.json(rules);
  }),
];

/* ------------------------------------------------------------------------- *
 * Calendar, blackouts, risk, post-implementation reviews
 * ------------------------------------------------------------------------- */

let blackouts: Blackout[] = [
  {
    id: '6f1c2a10-0000-4000-8000-000000000001',
    name: 'Year-end freeze',
    start: '2026-12-20T00:00:00.000Z',
    end: '2027-01-03T00:00:00.000Z',
    reason: 'Finance closing',
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: 'admin',
  },
];

const ref = (id: string, name: string) => ({ id, name });

/** Mock changes spread around today, two of them clashing on the mail relay. */
function calendarItems(): CalendarChange[] {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const at = (days: number, hours: number) => new Date(day.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
  const base = {
    organization: ref('1', 'Demo'),
    team: ref('7', 'Infrastructure'),
    outage: false,
    risk: null,
    clashes: [],
    blackouts: [],
  };
  const relay = ref('10', 'mail-relay-01');
  const mail = ref('5', 'E-mail');
  const items: CalendarChange[] = [
    { ...base, id: '12', ref: 'C-000012', title: 'Upgrade the mail relay', type: 'normal', status: 'approved', start: at(1, 20), end: at(1, 22), cis: [relay], services: [mail], outage: true, risk: 'medium' },
    { ...base, id: '13', ref: 'C-000013', title: 'Rotate relay certificates', type: 'routine', status: 'assigned', start: at(1, 21), end: '', cis: [relay], services: [mail] },
    { ...base, id: '14', ref: 'C-000014', title: 'Patch the firewall', type: 'emergency', status: 'implemented', start: at(-2, 9), end: at(-2, 10), cis: [ref('11', 'fw-01')], services: [], team: ref('8', 'Network') },
    { ...base, id: '15', ref: 'C-000015', title: 'Retire the old file share', type: 'normal', status: 'planned', start: at(6, 8), end: at(6, 12), cis: [ref('12', 'files-02')], services: [ref('6', 'File sharing')], organization: ref('2', 'Acme') },
  ];
  const on = [{ kind: 'ci' as const, name: relay.name }, { kind: 'service' as const, name: mail.name }];
  items[0]!.clashes = [{ changeId: '13', ref: 'C-000013', on }];
  items[1]!.clashes = [{ changeId: '12', ref: 'C-000012', on }];
  return items;
}

const distinct = (refs: Array<{ id: string; name: string }>) =>
  [...new Map(refs.map((r) => [r.id, r])).values()].sort((a, b) => a.name.localeCompare(b.name));

const option = (id: string, label: string, score: number) => ({ id, label, score });
const IMPACT = {
  id: 'impact',
  text: 'If it goes wrong, what is affected?',
  help: 'The widest reach of a failure.',
  weight: 3,
  options: [option('one-team', 'One team or a single CI', 0), option('one-service', 'One business service', 4), option('business', 'The whole business', 10)],
};
const ROLLBACK = {
  id: 'rollback',
  text: 'How hard is it to roll back?',
  help: '',
  weight: 3,
  options: [option('automatic', 'Automatic', 0), option('none', 'Not possible', 10)],
};
const TESTING = {
  id: 'testing',
  text: 'What testing was done?',
  help: '',
  weight: 2,
  options: [option('full', 'Full test', 0), option('none', 'Not tested', 10)],
};
const RISK_MODEL: RiskModel = {
  questions: { routine: [IMPACT, ROLLBACK], normal: [IMPACT, ROLLBACK, TESTING], emergency: [IMPACT] },
  thresholds: { medium: 35, high: 65 },
  requiredBeforePlan: { routine: false, normal: false, emergency: false },
};
let riskModel: RiskModelDto = { model: structuredClone(RISK_MODEL), defaults: RISK_MODEL, updatedAt: '', updatedBy: '' };
const riskAnswers = new Map<string, { answers: Record<string, string>; score: number; at: string }>();
const reviews = new Map<string, ChangePir['review']>();

function riskOf(id: string): RiskAssessment {
  const g = changeOf(id);
  const t = riskModel.model.thresholds;
  const kept = riskAnswers.get(id);
  const level = kept ? (kept.score >= t.high ? 'high' : kept.score >= t.medium ? 'medium' : 'low') : null;
  return {
    changeId: id,
    ref: g.ref,
    type: g.type,
    status: g.status,
    questions: riskModel.model.questions[g.type],
    answers: kept?.answers ?? {},
    score: kept?.score ?? null,
    level,
    thresholds: t,
    assessedBy: kept ? 'Mock Administrator' : '',
    assessedAt: kept?.at ?? '',
    stale: false,
    required: riskModel.model.requiredBeforePlan[g.type],
    forcesCab: g.type === 'routine' && level === 'high',
    canEdit: !['implemented', 'monitored', 'closed'].includes(g.status),
  };
}

/** Change 14 is implemented, so its review is due; the other mock changes are not in yet. */
const IMPLEMENTED = '14';

function pirOf(id: string): ChangePir {
  const g = changeOf(id);
  const allowed = id === IMPLEMENTED;
  const review = reviews.get(id) ?? null;
  return {
    changeId: id,
    ref: g.ref,
    title: g.title,
    type: g.type,
    status: allowed ? 'implemented' : g.status,
    allowed,
    due: allowed && !review,
    review,
  };
}

changeHandlers.push(
  http.get(url('/changes/calendar'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    const all = calendarItems().map((c) => ({
      ...c,
      blackouts: blackouts.filter((b) => b.start < (c.end || c.start) && b.end > c.start).map((b) => ref(b.id, b.name)),
    }));
    const items = all
      .filter((c) => !params.get('teamId') || c.team?.id === params.get('teamId'))
      .filter((c) => !params.get('ciId') || c.cis.some((x) => x.id === params.get('ciId')))
      .filter((c) => !params.get('serviceId') || c.services.some((x) => x.id === params.get('serviceId')))
      .filter((c) => !params.get('orgId') || c.organization.id === params.get('orgId'));
    return HttpResponse.json<ChangeCalendar>({
      from,
      to,
      items,
      blackouts: blackouts.filter((b) => b.start < to && b.end > from),
      options: {
        teams: distinct(all.flatMap((c) => (c.team ? [c.team] : []))),
        cis: distinct(all.flatMap((c) => c.cis)),
        services: distinct(all.flatMap((c) => c.services)),
        organizations: distinct(all.map((c) => c.organization)),
      },
      truncated: false,
    });
  }),

  http.get(url('/changes/blackouts'), () => HttpResponse.json({ items: blackouts })),

  http.get(url('/admin/change-blackouts'), () => HttpResponse.json({ items: blackouts })),

  http.post(url('/admin/change-blackouts'), async ({ request }) => {
    const body = (await request.json()) as BlackoutInput;
    if (body.end <= body.start) return refused(400, 'bad_request', 'A blackout window must end after it starts.');
    const created: Blackout = { ...body, id: crypto.randomUUID(), updatedAt: new Date().toISOString(), updatedBy: 'admin' };
    blackouts = [...blackouts, created].sort((a, b) => a.start.localeCompare(b.start));
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put(url('/admin/change-blackouts/:id'), async ({ params, request }) => {
    const body = (await request.json()) as BlackoutInput;
    const existing = blackouts.find((b) => b.id === params.id);
    if (!existing) return refused(404, 'not_found', 'That blackout window was not found.');
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    blackouts = blackouts.map((b) => (b.id === params.id ? updated : b));
    return HttpResponse.json(updated);
  }),

  http.delete(url('/admin/change-blackouts/:id'), ({ params }) => {
    blackouts = blackouts.filter((b) => b.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(url('/changes/:id/risk'), ({ params }) => HttpResponse.json(riskOf(String(params.id)))),

  http.put(url('/changes/:id/risk'), async ({ params, request }) => {
    const id = String(params.id);
    const { answers } = (await request.json()) as { answers: Record<string, string> };
    let total = 0;
    let max = 0;
    for (const q of riskModel.model.questions[changeOf(id).type]) {
      const chosen = q.options.find((o) => o.id === answers[q.id]);
      if (!chosen) return refused(400, 'bad_request', `Answer every question: "${q.text}".`);
      total += q.weight * chosen.score;
      max += q.weight * 10;
    }
    riskAnswers.set(id, { answers, score: Math.round((100 * total) / max), at: new Date().toISOString() });
    return HttpResponse.json(riskOf(id));
  }),

  http.get(url('/admin/change-risk'), () => HttpResponse.json(riskModel)),

  http.put(url('/admin/change-risk'), async ({ request }) => {
    const { model } = (await request.json()) as { model: RiskModel };
    riskModel = { ...riskModel, model, updatedAt: new Date().toISOString(), updatedBy: 'admin' };
    return HttpResponse.json(riskModel);
  }),

  http.get(url('/changes/pir-due'), () => {
    const items: PirDueItem[] = reviews.has(IMPLEMENTED)
      ? []
      : [
          {
            id: IMPLEMENTED,
            ref: 'C-000014',
            title: 'Patch the firewall',
            type: 'emergency',
            status: 'implemented',
            organization: 'Demo',
            team: 'Network',
            endDate: '2026-10-27T10:00:00.000Z',
            closedAt: '',
          },
        ];
    return HttpResponse.json<PirQueue>({ items, lookbackDays: 90 });
  }),

  http.get(url('/changes/:id/pir'), ({ params }) => HttpResponse.json(pirOf(String(params.id)))),

  http.put(url('/changes/:id/pir'), async ({ params, request }) => {
    const id = String(params.id);
    if (!pirOf(id).allowed) return refused(409, 'conflict', 'A change is reviewed once it is implemented.');
    const body = (await request.json()) as PirInput;
    if (body.outcome !== 'successful' && !body.wentBadly.trim()) {
      return refused(400, 'bad_request', 'Say what did not go well: the change was not fully successful.');
    }
    reviews.set(id, {
      outcome: body.outcome,
      wentWell: body.wentWell,
      wentBadly: body.wentBadly,
      incidents: body.incidents.map((r, i) => ({ id: String(100 + i), ref: r, title: 'Mock incident' })),
      followUps: body.followUps,
      completedBy: 'Mock Administrator',
      completedAt: new Date().toISOString(),
    });
    return HttpResponse.json(pirOf(id));
  }),
);
