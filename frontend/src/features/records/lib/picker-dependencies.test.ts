import { describe, expect, it } from 'vitest';
import type { ClassInfo, FieldSpec } from '../types';
import { dependentsOf, narrowsByParent, pickerContext, unsetParent } from './picker-dependencies';

const caller = {
  type: 'ExternalKey',
  ui: 'picker',
  target: 'Person',
  dependsOn: ['org_id'],
  filter: 'SELECT Person WHERE org_id = :this->org_id',
} as FieldSpec;

const team = {
  type: 'ExternalKey',
  ui: 'picker',
  target: 'Team',
  dependsOn: ['org_id'],
  filter: 'SELECT Team AS t JOIN lnkDeliveryModelToContact AS l ON l.contact_id=t.id WHERE t.org_id = :this->org_id',
} as FieldSpec;

const org = { type: 'ExternalKey', ui: 'picker', target: 'Organization' } as FieldSpec;

const info = {
  name: 'Incident',
  writable: ['org_id', 'caller_id', 'team_id'],
  fields: { org_id: org, caller_id: caller, team_id: team },
} as unknown as ClassInfo;

describe('picker dependencies', () => {
  it('treats only a flat filter on a form value as narrowing', () => {
    expect(narrowsByParent(caller)).toBe(true);
    expect(narrowsByParent(team)).toBe(false);
    expect(narrowsByParent(org)).toBe(false);
  });

  it('sends the organization with the caller request, and nothing for a JOIN filter', () => {
    expect(pickerContext('Incident', caller, { org_id: '12' })).toEqual({ org_id: '12' });
    expect(pickerContext('Incident', team, { org_id: '12' })).toEqual({});
  });

  it('leaves out an unset parent, including iTop\'s 0', () => {
    expect(pickerContext('Incident', caller, { org_id: '' })).toEqual({});
    expect(pickerContext('Incident', caller, { org_id: 0 })).toEqual({});
  });

  it('fills finalclass with the class being edited', () => {
    const model = { ...caller, dependsOn: ['brand_id', 'finalclass'], filter: 'SELECT Model WHERE brand_id=:this->brand_id AND type=:this->finalclass' };
    expect(pickerContext('Server', model, { brand_id: '3' })).toEqual({ brand_id: '3', finalclass: 'Server' });
  });

  it('holds the caller back until the organization is chosen', () => {
    expect(unsetParent(info, caller, {})).toBe('org_id');
    expect(unsetParent(info, caller, { org_id: '12' })).toBeUndefined();
    expect(unsetParent(info, team, {})).toBeUndefined();
  });

  it('does not wait on a parent the user cannot fill', () => {
    expect(unsetParent({ ...info, writable: ['caller_id'] } as ClassInfo, caller, {})).toBeUndefined();
  });

  it('finds what a change invalidates', () => {
    expect(dependentsOf(info, 'org_id')).toEqual(['caller_id']);
    expect(dependentsOf(info, 'caller_id')).toEqual([]);
  });
});
