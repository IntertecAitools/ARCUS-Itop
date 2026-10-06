import { describe, expect, it } from 'vitest';
import {
  FIELD_RULES,
  NO_STATUS,
  allowedTransitions,
  emptyProblemCreateValues,
  fieldMode,
  parseProblemFilters,
  previewPriority,
  problemCreateSchema,
  problemEditSchema,
  serializeProblemFilters,
  toProblemListQuery,
  toTransitionFields,
  transitionSchema,
  visibleDates,
} from './schemas';

describe('priority matrix', () => {
  it.each([
    ['1', '1', '1'],
    ['1', '2', '1'],
    ['1', '3', '2'],
    ['1', '4', '4'],
    ['2', '1', '1'],
    ['2', '2', '2'],
    ['2', '3', '3'],
    ['2', '4', '4'],
    ['3', '1', '2'],
    ['3', '2', '3'],
    ['3', '3', '3'],
    ['3', '4', '4'],
  ])('impact %s × urgency %s → priority %s', (impact, urgency, priority) => {
    expect(previewPriority(impact, urgency)).toBe(priority);
  });

  it('returns null until both values are chosen', () => {
    expect(previewPriority('1', '')).toBeNull();
    expect(previewPriority(undefined, '2')).toBeNull();
  });
});

describe('lifecycle', () => {
  it('allows only the iTop stimuli for each state', () => {
    expect(allowedTransitions('new').map((t) => t.stimulus)).toEqual(['ev_assign']);
    expect(allowedTransitions('assigned').map((t) => t.stimulus)).toEqual(['ev_reassign', 'ev_resolve']);
    expect(allowedTransitions('resolved').map((t) => t.stimulus)).toEqual(['ev_reassign', 'ev_close']);
    expect(allowedTransitions('closed')).toEqual([]);
  });

  it('declares required and prompted fields per stimulus', () => {
    const resolve = allowedTransitions('assigned').find((t) => t.stimulus === 'ev_resolve')!;
    expect(resolve.target).toBe('resolved');
    expect(resolve.required).toEqual(['service_id']);
    expect(resolve.prompted).toEqual(['servicesubcategory_id', 'product']);
    const assign = allowedTransitions('new')[0]!;
    expect(assign.required).toEqual(['team_id', 'agent_id']);
  });

  it('applies field rules per state', () => {
    expect(fieldMode('new', 'team_id')).toBe('hidden');
    expect(fieldMode('new', 'impact')).toBe('mandatory');
    expect(fieldMode('assigned', 'agent_id')).toBe('mandatory');
    expect(fieldMode('resolved', 'title')).toBe('readonly');
    expect(fieldMode('resolved', 'service_id')).toBe('mandatory');
    expect(Object.values(FIELD_RULES.closed).every((m) => m === 'readonly')).toBe(true);
  });

  it('shows dates that exist in each state', () => {
    expect(visibleDates('new')).toEqual(['start_date', 'last_update']);
    expect(visibleDates('closed')).toContain('close_date');
  });
});

describe('problemCreateSchema', () => {
  it('requires org, title, description, impact and urgency', () => {
    const result = problemCreateSchema.safeParse(emptyProblemCreateValues);
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['org', 'title', 'description', 'impact', 'urgency']));
    expect(result.error!.issues.every((i) => i.message === 'validation.required')).toBe(true);
  });

  it('treats empty HTML as an empty description', () => {
    const result = problemCreateSchema.safeParse({ ...emptyProblemCreateValues, description: '<p>&nbsp;</p>' });
    expect(result.error!.issues.some((i) => i.path[0] === 'description')).toBe(true);
  });

  it('accepts a complete problem', () => {
    const result = problemCreateSchema.safeParse({
      ...emptyProblemCreateValues,
      org: { id: '1', label: 'Demo Corp' },
      title: 'VPN drops',
      description: '<p>Tunnels drop</p>',
      impact: '2',
      urgency: '1',
    });
    expect(result.success).toBe(true);
  });
});

describe('problemEditSchema', () => {
  const base = {
    org: { id: '1', label: 'Demo Corp' },
    caller: null,
    title: 'T',
    description: '<p>D</p>',
    service: null,
    subcategory: null,
    product: '',
    impact: '2' as const,
    urgency: '2' as const,
    team: null,
    agent: null,
  };

  it('requires team and agent once assigned', () => {
    expect(problemEditSchema('new').safeParse(base).success).toBe(true);
    const assigned = problemEditSchema('assigned').safeParse(base);
    expect(assigned.error!.issues.map((i) => i.path[0])).toEqual(['team', 'agent']);
  });

  it('requires a service once resolved', () => {
    const resolved = problemEditSchema('resolved').safeParse(base);
    expect(resolved.error!.issues.map((i) => i.path[0])).toEqual(['service']);
  });
});

describe('transition schemas', () => {
  const values = { team: null, agent: null, service: null, subcategory: null, product: '', note: '' };

  it('ev_assign needs team and agent', () => {
    const result = transitionSchema('ev_assign').safeParse(values);
    expect(result.error!.issues.map((i) => i.path[0])).toEqual(['team', 'agent']);
  });

  it('ev_close needs nothing', () => {
    expect(transitionSchema('ev_close').safeParse(values).success).toBe(true);
  });

  it('sends only the fields of the stimulus', () => {
    const fields = toTransitionFields('ev_resolve', {
      ...values,
      team: { id: '9', label: 'ignored' },
      service: { id: '2', label: 'Network' },
      product: 'GlobalProtect',
    });
    expect(fields).toEqual({ service_id: '2', servicesubcategory_id: null, product: 'GlobalProtect' });
  });
});

describe('list filters in the URL', () => {
  it('round-trips through search params', () => {
    const filters = parseProblemFilters(
      new URLSearchParams('tab=open&status=new&priority=1,2&orgId=3&q=vpn&from=2026-09-01&sort=priority&page=2&pageSize=25'),
    );
    expect(filters).toMatchObject({
      tab: 'open',
      status: ['new'],
      priority: ['1', '2'],
      orgId: '3',
      q: 'vpn',
      from: '2026-09-01',
      sort: 'priority',
      page: 2,
      pageSize: 25,
    });
    expect(parseProblemFilters(serializeProblemFilters(filters))).toEqual(filters);
  });

  it('ignores invalid values and omits defaults', () => {
    const filters = parseProblemFilters(new URLSearchParams('tab=bogus&status=new,deleted&page=-3&pageSize=7'));
    expect(filters).toMatchObject({ tab: 'all', status: ['new'], page: 1, pageSize: 10 });
    expect(serializeProblemFilters({ ...filters, status: [] }).toString()).toBe('');
  });

  it('maps tabs to BFF query params', () => {
    const base = parseProblemFilters(new URLSearchParams());
    expect(toProblemListQuery({ ...base, tab: 'open' }).status).toEqual(['new', 'assigned']);
    expect(toProblemListQuery({ ...base, tab: 'mine' }, '42').agentId).toBe('42');
    expect(toProblemListQuery({ ...base, tab: 'open', status: ['assigned', 'closed'] }).status).toEqual(['assigned']);
    expect(toProblemListQuery({ ...base, tab: 'closed', status: ['new'] }).status).toEqual([NO_STATUS]);
  });
});
