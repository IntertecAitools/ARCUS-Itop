/**
 * Problem rules kept as data, mirroring iTop's itop-problem-mgmt lifecycle,
 * plus the Zod schemas that forms build from them.
 */
import { z } from 'zod';
import { lookupOptionSchema } from '@/features/contacts';
import { hasText } from '@/features/tickets';
import type { Tone } from '@/theme';
import type { QueryParams } from '@/lib/api-client';
import type {
  FieldMode,
  Problem,
  ProblemField,
  ProblemFilters,
  ProblemImpact,
  ProblemListTab,
  ProblemPriority,
  ProblemStatus,
  ProblemStimulus,
  ProblemTransition,
  ProblemUrgency,
} from './types';

// ─── Enumerations ────────────────────────────────────────────────────────────

export const PROBLEM_STATUSES = ['new', 'assigned', 'resolved', 'closed'] as const satisfies readonly ProblemStatus[];
export const PROBLEM_IMPACTS = ['1', '2', '3'] as const satisfies readonly ProblemImpact[];
export const PROBLEM_URGENCIES = ['1', '2', '3', '4'] as const satisfies readonly ProblemUrgency[];
export const PROBLEM_PRIORITIES = ['1', '2', '3', '4'] as const satisfies readonly ProblemPriority[];
export const PROBLEM_LIST_TABS = ['all', 'open', 'unassigned', 'mine', 'resolved', 'closed'] as const satisfies readonly ProblemListTab[];

const statusTones: Record<ProblemStatus, Tone> = {
  new: 'status-new',
  assigned: 'status-assigned',
  resolved: 'status-resolved',
  closed: 'status-closed',
};

export function problemStatusTone(status: ProblemStatus): Tone {
  return statusTones[status];
}

// ─── Priority (computed by iTop; UI preview only) ────────────────────────────

/** impact × urgency → priority. Rows: impact 1..3, columns: urgency 1..4. */
export const PRIORITY_MATRIX: Record<ProblemImpact, Record<ProblemUrgency, ProblemPriority>> = {
  '1': { '1': '1', '2': '1', '3': '2', '4': '4' },
  '2': { '1': '1', '2': '2', '3': '3', '4': '4' },
  '3': { '1': '2', '2': '3', '3': '3', '4': '4' },
};

export function previewPriority(impact?: string | null, urgency?: string | null): ProblemPriority | null {
  if (!impact || !urgency) return null;
  return PRIORITY_MATRIX[impact as ProblemImpact]?.[urgency as ProblemUrgency] ?? null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Allowed stimuli per state and their target state */
export const TRANSITIONS: Record<ProblemStatus, Array<{ stimulus: ProblemStimulus; target: ProblemStatus }>> = {
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

/** Fields the target state requires (mandatory) or asks for (must_prompt) */
export const STIMULUS_FIELDS: Record<ProblemStimulus, { required: ProblemField[]; prompted: ProblemField[] }> = {
  ev_assign: { required: ['team_id', 'agent_id'], prompted: [] },
  ev_reassign: { required: ['team_id', 'agent_id'], prompted: [] },
  ev_resolve: { required: ['service_id'], prompted: ['servicesubcategory_id', 'product'] },
  ev_close: { required: [], prompted: [] },
};

export function allowedTransitions(status: ProblemStatus): ProblemTransition[] {
  return TRANSITIONS[status].map((t) => ({ ...t, ...STIMULUS_FIELDS[t.stimulus] }));
}

/** Field flags per state (iTop: new → assigned → resolved → closed, flags inherited) */
export const FIELD_RULES: Record<ProblemStatus, Record<ProblemField, FieldMode>> = {
  new: {
    org_id: 'mandatory',
    caller_id: 'optional',
    title: 'mandatory',
    description: 'mandatory',
    service_id: 'optional',
    servicesubcategory_id: 'optional',
    product: 'optional',
    impact: 'mandatory',
    urgency: 'mandatory',
    team_id: 'hidden',
    agent_id: 'hidden',
    related_change_id: 'optional',
  },
  assigned: {
    org_id: 'mandatory',
    caller_id: 'optional',
    title: 'mandatory',
    description: 'mandatory',
    service_id: 'optional',
    servicesubcategory_id: 'optional',
    product: 'optional',
    impact: 'mandatory',
    urgency: 'mandatory',
    team_id: 'mandatory',
    agent_id: 'mandatory',
    related_change_id: 'optional',
  },
  resolved: {
    org_id: 'readonly',
    caller_id: 'readonly',
    title: 'readonly',
    description: 'readonly',
    service_id: 'mandatory',
    servicesubcategory_id: 'optional',
    product: 'optional',
    impact: 'readonly',
    urgency: 'readonly',
    team_id: 'readonly',
    agent_id: 'readonly',
    related_change_id: 'optional',
  },
  closed: {
    org_id: 'readonly',
    caller_id: 'readonly',
    title: 'readonly',
    description: 'readonly',
    service_id: 'readonly',
    servicesubcategory_id: 'readonly',
    product: 'readonly',
    impact: 'readonly',
    urgency: 'readonly',
    team_id: 'readonly',
    agent_id: 'readonly',
    related_change_id: 'readonly',
  },
};

export function fieldMode(status: ProblemStatus, field: ProblemField): FieldMode {
  return FIELD_RULES[status][field];
}

export function isEditable(status: ProblemStatus, field: ProblemField): boolean {
  const mode = fieldMode(status, field);
  return mode === 'optional' || mode === 'mandatory';
}

/** Read-only date attributes visible in each state */
export function visibleDates(status: ProblemStatus): Array<'start_date' | 'last_update' | 'assignment_date' | 'resolution_date' | 'close_date'> {
  const dates: Array<'start_date' | 'last_update' | 'assignment_date' | 'resolution_date' | 'close_date'> = [
    'start_date',
    'last_update',
  ];
  if (status !== 'new') dates.push('assignment_date');
  if (status === 'resolved' || status === 'closed') dates.push('resolution_date');
  if (status === 'closed') dates.push('close_date');
  return dates;
}

// ─── Zod: create form ────────────────────────────────────────────────────────

const lookup = lookupOptionSchema;
const requiredLookup = lookup.nullable().refine((v) => v !== null, { message: 'validation.required' });
const requiredChoice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.literal('')]).refine((v) => v !== '', { message: 'validation.required' });

export const problemCreateSchema = z.object({
  org: requiredLookup,
  caller: lookup.nullable(),
  title: z.string().trim().min(1, 'validation.required').max(255, 'validation.tooLong'),
  description: z.string().refine(hasText, { message: 'validation.required' }),
  service: lookup.nullable(),
  subcategory: lookup.nullable(),
  product: z.string().max(255, 'validation.tooLong'),
  impact: requiredChoice(PROBLEM_IMPACTS),
  urgency: requiredChoice(PROBLEM_URGENCIES),
  cis: z.array(lookup),
  contacts: z.array(lookup),
  incidents: z.array(lookup),
});

export type ProblemCreateValues = z.input<typeof problemCreateSchema>;

export const emptyProblemCreateValues: ProblemCreateValues = {
  org: null,
  caller: null,
  title: '',
  description: '',
  service: null,
  subcategory: null,
  product: '',
  impact: '',
  urgency: '',
  cis: [],
  contacts: [],
  incidents: [],
};

// ─── Zod: details edit form (driven by FIELD_RULES) ──────────────────────────

/** Form key → iTop attribute */
export const EDIT_FORM_FIELDS = {
  org: 'org_id',
  caller: 'caller_id',
  title: 'title',
  description: 'description',
  service: 'service_id',
  subcategory: 'servicesubcategory_id',
  product: 'product',
  impact: 'impact',
  urgency: 'urgency',
  team: 'team_id',
  agent: 'agent_id',
} as const satisfies Record<string, ProblemField>;

export type EditFormKey = keyof typeof EDIT_FORM_FIELDS;

const editShape = z.object({
  org: lookup.nullable(),
  caller: lookup.nullable(),
  title: z.string().max(255, 'validation.tooLong'),
  description: z.string(),
  service: lookup.nullable(),
  subcategory: lookup.nullable(),
  product: z.string().max(255, 'validation.tooLong'),
  impact: z.union([z.enum(PROBLEM_IMPACTS), z.literal('')]),
  urgency: z.union([z.enum(PROBLEM_URGENCIES), z.literal('')]),
  team: lookup.nullable(),
  agent: lookup.nullable(),
});

export type ProblemEditValues = z.input<typeof editShape>;

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !hasText(value);
  return false;
}

/** Edit schema for a state: mandatory fields of that state must be filled. */
export function problemEditSchema(status: ProblemStatus) {
  return editShape.superRefine((values, ctx) => {
    for (const [key, field] of Object.entries(EDIT_FORM_FIELDS) as Array<[EditFormKey, ProblemField]>) {
      if (fieldMode(status, field) === 'mandatory' && isEmptyValue(values[key])) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'validation.required' });
      }
    }
  });
}

export function problemToEditValues(p: Problem): ProblemEditValues {
  const opt = (id: string | null, label: string | null) => (id ? { id, label: label ?? id } : null);
  return {
    org: opt(p.org_id, p.org_name),
    caller: opt(p.caller_id, p.caller_name),
    title: p.title,
    description: p.description,
    service: opt(p.service_id, p.service_name),
    subcategory: opt(p.servicesubcategory_id, p.servicesubcategory_name),
    product: p.product,
    impact: p.impact,
    urgency: p.urgency,
    team: opt(p.team_id, p.team_name),
    agent: opt(p.agent_id, p.agent_name),
  };
}

// ─── Zod: transition dialog (one schema per stimulus) ────────────────────────

export interface TransitionFormValues {
  team: z.infer<typeof lookup> | null;
  agent: z.infer<typeof lookup> | null;
  service: z.infer<typeof lookup> | null;
  subcategory: z.infer<typeof lookup> | null;
  product: string;
  note: string;
}

/** ProblemField → transition form key */
export const TRANSITION_FORM_FIELDS: Partial<Record<ProblemField, keyof TransitionFormValues>> = {
  team_id: 'team',
  agent_id: 'agent',
  service_id: 'service',
  servicesubcategory_id: 'subcategory',
  product: 'product',
};

export function transitionSchema(stimulus: ProblemStimulus) {
  const { required } = STIMULUS_FIELDS[stimulus];
  const pick = (field: ProblemField) => (required.includes(field) ? requiredLookup : lookup.nullable());
  return z.object({
    team: pick('team_id'),
    agent: pick('agent_id'),
    service: pick('service_id'),
    subcategory: pick('servicesubcategory_id'),
    product: z.string().max(255, 'validation.tooLong'),
    note: z.string(),
  });
}

/** Build the API body with only the fields this stimulus requires or prompts. */
export function toTransitionFields(stimulus: ProblemStimulus, values: TransitionFormValues) {
  const { required, prompted } = STIMULUS_FIELDS[stimulus];
  const fields: Partial<Record<ProblemField, string | null>> = {};
  for (const field of [...required, ...prompted]) {
    const key = TRANSITION_FORM_FIELDS[field];
    if (!key) continue;
    const value = values[key];
    fields[field] = typeof value === 'string' ? value : (value?.id ?? null);
  }
  return fields;
}

// ─── List filters ⇄ URL search params ────────────────────────────────────────

export const DEFAULT_SORT = '-start_date';
export const DEFAULT_PAGE_SIZE = 10;

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  return raw.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
}

export function parseProblemFilters(params: URLSearchParams): ProblemFilters {
  const tab = params.get('tab');
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('pageSize'));
  return {
    tab: (PROBLEM_LIST_TABS as readonly string[]).includes(tab ?? '') ? (tab as ProblemListTab) : 'all',
    status: parseList(params.get('status'), PROBLEM_STATUSES),
    priority: parseList(params.get('priority'), PROBLEM_PRIORITIES),
    impact: parseList(params.get('impact'), PROBLEM_IMPACTS),
    urgency: parseList(params.get('urgency'), PROBLEM_URGENCIES),
    orgId: params.get('orgId') || undefined,
    teamId: params.get('teamId') || undefined,
    agentId: params.get('agentId') || undefined,
    serviceId: params.get('serviceId') || undefined,
    q: params.get('q') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    sort: params.get('sort') || DEFAULT_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 25, 50].includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

/** Only non-default values are written, so URLs stay short and shareable. */
export function serializeProblemFilters(filters: ProblemFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== 'all') params.set('tab', filters.tab);
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.priority.length) params.set('priority', filters.priority.join(','));
  if (filters.impact.length) params.set('impact', filters.impact.join(','));
  if (filters.urgency.length) params.set('urgency', filters.urgency.join(','));
  for (const key of ['orgId', 'teamId', 'agentId', 'serviceId', 'q', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));
  return params;
}

const TAB_STATUSES: Record<ProblemListTab, ProblemStatus[]> = {
  all: [],
  open: ['new', 'assigned'],
  unassigned: ['new'],
  mine: [],
  resolved: ['resolved'],
  closed: ['closed'],
};

/** Status codes the BFF matches nothing with (tab ∩ status filter is empty) */
export const NO_STATUS = 'none';

/** URL filters → BFF query params. The "mine" tab needs the current user's person id. */
export function toProblemListQuery(filters: ProblemFilters, myPersonId?: string): QueryParams {
  const tabStatuses = TAB_STATUSES[filters.tab];
  let status: string[] = filters.status;
  if (tabStatuses.length && filters.status.length) {
    status = filters.status.filter((s) => tabStatuses.includes(s));
    if (status.length === 0) status = [NO_STATUS];
  } else if (tabStatuses.length) {
    status = tabStatuses;
  }
  return {
    status,
    priority: filters.priority,
    impact: filters.impact,
    urgency: filters.urgency,
    orgId: filters.orgId,
    teamId: filters.teamId,
    agentId: filters.tab === 'mine' ? myPersonId : filters.agentId,
    serviceId: filters.serviceId,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}
