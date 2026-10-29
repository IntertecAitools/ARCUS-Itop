import { describe, expect, it } from 'vitest';
import { suggestMapping } from '@/features/records';
import { organizationInfo, userRequestInfo } from '@/mocks/fixtures/records';
import { defaultKeys, duration, fileToBase64, LOOKUPS, suggestSyncColumns, syncTargets } from './wizard';

describe('data import wizard helpers', () => {
  it('matches references by name, and people by full name or email', () => {
    expect(suggestMapping(organizationInfo, ['Name', 'Parent'], LOOKUPS)).toEqual(['name', 'parent_id->name']);
    expect(suggestMapping(userRequestInfo, ['Title', 'Caller'], LOOKUPS)).toEqual(['title', 'caller_id->friendlyname']);
    expect(LOOKUPS.lookups?.('Person').map((l) => l.value)).toEqual(['friendlyname', 'email']);
    // Without options the records import keeps its friendly-name match.
    expect(suggestMapping(organizationInfo, ['Parent'])).toEqual(['parent_id->friendlyname']);
  });

  it('spells the class keys as the mapped columns do, leaving out what the file lacks', () => {
    const server = { name: 'Server', label: 'Server', defaultKeys: ['name', 'org_id->name'] };
    expect(defaultKeys(server, ['name', 'org_id->name', 'nb_u'])).toEqual(['name', 'org_id->name']);
    expect(defaultKeys(server, ['name', 'org_id'])).toEqual(['name', 'org_id']);
    expect(defaultKeys(server, ['nb_u'])).toEqual([]);
    expect(defaultKeys(undefined, ['name'])).toEqual([]);
  });

  it('suggests a feed file’s columns: exact names, and an id column as primary_key', () => {
    const targets = syncTargets([
      { attcode: 'name', update: true, reconcile: true, updatePolicy: 'master_locked' },
      { attcode: 'org_id', update: true, reconcile: false, updatePolicy: 'master_locked', lookup: 'name' },
      { attcode: 'status', update: false, reconcile: false, updatePolicy: 'master_locked' },
    ]);
    expect(targets).toEqual(['primary_key', 'name', 'org_id']);
    expect(suggestSyncColumns(['External ID', 'Name', 'org_id', 'Status', 'name'], targets)).toEqual([
      'primary_key',
      'name',
      'org_id',
      null,
      null,
    ]);
  });

  it('reads durations and files', async () => {
    expect(duration(0)).toBe('never');
    expect(duration(86_400 * 30)).toBe('30 days');
    expect(duration(7200)).toBe('2 h');
    expect(duration(90)).toBe('2 min');
    expect(await fileToBase64(new Blob(['name\nweb-01\n']))).toBe(btoa('name\nweb-01\n'));
  });
});
