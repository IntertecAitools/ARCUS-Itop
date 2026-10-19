import { describe, expect, it } from 'vitest';
import { headerOf } from './RecordImportPage';

describe('headerOf', () => {
  it('reads the first non-empty line, unquoted', () => {
    expect(headerOf('\n"name","org_id->name",status\nweb-01,Demo,production', ',')).toEqual([
      'name',
      'org_id->name',
      'status',
    ]);
  });

  it('splits on the chosen separator', () => {
    expect(headerOf('name;status\nx;y', ';')).toEqual(['name', 'status']);
    expect(headerOf('name\tstatus', '\t')).toEqual(['name', 'status']);
  });

  it('is empty for an empty file', () => {
    expect(headerOf('  \n', ',')).toEqual([]);
  });
});
