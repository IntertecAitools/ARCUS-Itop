import { describe, expect, it } from 'vitest';
import { describeEvent, describeRecipients, insertToken } from './describe';
import type { RuleEvent } from '../types';

const event = (e: Partial<RuleEvent>): RuleEvent => ({
  kind: 'created',
  recordType: 'UserRequest',
  hasCondition: false,
  firesFromPlatform: true,
  ...e,
});

describe('describeEvent', () => {
  it('reads like a sentence, with the labels it is given', () => {
    expect(describeEvent(event({ kind: 'state_entered', state: 'resolved' }), { recordType: 'User Request', state: 'Resolved' })).toBe(
      'A User Request enters Resolved',
    );
    expect(describeEvent(event({ kind: 'created', recordType: 'Incident' }))).toBe('An Incident is created');
    expect(describeEvent(event({ kind: 'updated', fields: ['priority', 'team_id'] }), { recordType: 'Incident', fields: ['Priority', 'Team'] })).toBe(
      'An Incident’s Priority or Team changes',
    );
    expect(describeEvent(event({ kind: 'sla_threshold', sla: { timer: 'ttr', percent: '75' } }), { recordType: 'Incident' })).toBe(
      'An Incident reaches 75% of its time to resolve',
    );
  });
});

describe('describeRecipients', () => {
  it('names roles and people, and flags lists set up in iTop', () => {
    expect(
      describeRecipients([{ kind: 'caller' }, { kind: 'people', people: [{ id: 1, name: 'Jane Doe' }] }, { kind: 'custom', index: 0 }]),
    ).toBe('The caller, Jane Doe, A list set up in iTop');
    expect(describeRecipients([])).toBe('—');
  });
});

describe('insertToken', () => {
  it('inserts at the cursor, replacing a selection', () => {
    expect(insertToken('Ticket  done', 'ref', { start: 7, end: 7 })).toEqual({ text: 'Ticket {{ref}} done', cursor: 14 });
    expect(insertToken('abc', 'link', null)).toEqual({ text: 'abc{{link}}', cursor: 11 });
  });
});
