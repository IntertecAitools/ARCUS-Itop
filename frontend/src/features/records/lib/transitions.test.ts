import { describe, expect, it } from 'vitest';
import type { ClassInfo, RecordDto } from '../types';
import { asksNextActionDate, offeredActions, requiredForTransition, transitionPrompts } from './transitions';

/**
 * The rule iTop's stimulus form follows: prompt for what the TARGET state
 * flags must_change / must_prompt, or mandatory while still empty. These
 * flags are lifted from UserRequest in the installed datamodel.
 */
const info = {
  name: 'UserRequest',
  writable: ['status', 'solution', 'resolution_code', 'agent_id', 'team_id', 'pending_reason', 'org_id'],
  fields: {
    status: { type: 'Enum', ui: 'scalar' },
    solution: { type: 'Text', ui: 'scalar' },
    resolution_code: { type: 'Enum', ui: 'scalar' },
    agent_id: { type: 'ExternalKey', ui: 'picker' },
    team_id: { type: 'ExternalKey', ui: 'picker' },
    pending_reason: { type: 'Text', ui: 'scalar' },
    org_id: { type: 'ExternalKey', ui: 'picker' },
    org_name: { type: 'ExternalField', ui: 'readonly' },
  },
  lifecycle: {
    attribute: 'status',
    states: { new: ['ev_assign'], assigned: ['ev_resolve', 'ev_pending'], resolved: ['ev_close'] },
    stimuli: ['ev_assign', 'ev_resolve', 'ev_pending', 'ev_close'],
    transitions: {
      new: { ev_assign: 'assigned' },
      assigned: { ev_resolve: 'resolved', ev_pending: 'pending' },
      resolved: { ev_close: 'closed' },
    },
    flags: {
      assigned: { agent_id: ['mandatory'], team_id: ['mandatory'], org_id: ['mandatory'] },
      resolved: {
        solution: ['mandatory', 'must_prompt'],
        resolution_code: ['mandatory', 'must_prompt'],
        org_name: ['mandatory'],
      },
      pending: { pending_reason: ['mandatory', 'must_prompt'] },
      closed: {},
    },
  },
} as unknown as ClassInfo;

const record = (fields: Record<string, unknown>): RecordDto => ({
  class: 'UserRequest',
  id: 1,
  label: 'R-000001',
  fields,
});

describe('transitionPrompts', () => {
  it('asks for the solution and resolution code when resolving', () => {
    const prompts = transitionPrompts(info, record({ status: 'assigned' }), 'ev_resolve');
    expect(prompts.sort()).toEqual(['resolution_code', 'solution']);
  });

  it('asks for mandatory fields only while they are empty', () => {
    // org_id is already set; a 0 agent is iTop's "not set".
    const prompts = transitionPrompts(
      info,
      record({ status: 'new', org_id: '3', agent_id: '0', team_id: '' }),
      'ev_assign',
    );
    expect(prompts.sort()).toEqual(['agent_id', 'team_id']);
  });

  it('never prompts for a computed field, even when flagged mandatory', () => {
    const prompts = transitionPrompts(info, record({ status: 'assigned' }), 'ev_resolve');
    expect(prompts).not.toContain('org_name');
  });

  it('applies an action that needs nothing without a form', () => {
    expect(transitionPrompts(info, record({ status: 'resolved' }), 'ev_close')).toEqual([]);
  });

  it('marks only mandatory prompts as required', () => {
    const required = requiredForTransition(info, record({ status: 'assigned' }), 'ev_pending');
    expect([...required]).toEqual(['pending_reason']);
  });
});

describe('asksNextActionDate', () => {
  it('asks for a date when the action puts an incident or a user request on hold, and only then', () => {
    const assigned = record({ status: 'assigned' });
    expect(asksNextActionDate(info, assigned, 'ev_pending')).toBe(true);
    expect(asksNextActionDate({ ...info, name: 'Incident' } as ClassInfo, assigned, 'ev_pending')).toBe(true);
    expect(asksNextActionDate(info, assigned, 'ev_resolve')).toBe(false);
    expect(asksNextActionDate(info, record({ status: 'new' }), 'ev_pending')).toBe(false);
    expect(asksNextActionDate({ ...info, name: 'Change' } as ClassInfo, assigned, 'ev_pending')).toBe(false);
  });
});

describe('offeredActions', () => {
  const withLifecycle = (extra: Partial<NonNullable<ClassInfo['lifecycle']>>) =>
    ({ ...info, lifecycle: { ...info.lifecycle!, ...extra } }) as ClassInfo;

  it("offers the state's user actions when the BFF sends no grants", () => {
    expect(offeredActions(withLifecycle({ userActions: ['ev_resolve', 'ev_pending'] }), 'assigned')).toEqual([
      'ev_resolve',
      'ev_pending',
    ]);
  });

  it("offers only what the user's iTop profiles grant", () => {
    const desk = withLifecycle({ userActions: ['ev_assign', 'ev_resolve', 'ev_pending'], allowedActions: ['ev_assign'] });
    expect(offeredActions(desk, 'new')).toEqual(['ev_assign']);
    expect(offeredActions(desk, 'assigned')).toEqual([]);
    expect(offeredActions(withLifecycle({ allowedActions: [] }), 'resolved')).toEqual([]);
  });
});
