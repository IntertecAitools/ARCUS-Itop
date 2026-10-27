import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  CabDecisionInput,
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
