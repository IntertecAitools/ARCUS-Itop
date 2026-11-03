import { describe, expect, it } from 'vitest';
import { guessSeparator, headerOf } from './RecordImportPage';

describe('guessSeparator', () => {
  it('picks the separator that splits the header', () => {
    expect(guessSeparator('icon,name\nlaptop,End User Computing')).toBe(',');
    expect(guessSeparator('name;status\nx;y')).toBe(';');
    expect(guessSeparator('name\tstatus\nx\ty')).toBe('\t');
  });

  it('ignores separators inside quoted headings', () => {
    expect(guessSeparator('"Caller, name";Status\nx;y')).toBe(';');
  });

  it('is null for a one-column or empty file', () => {
    expect(guessSeparator('name\nEnd User Computing')).toBeNull();
    expect(guessSeparator('')).toBeNull();
  });
});

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

  it('keeps a separator inside quotes, doubled quotes and unnamed columns', () => {
    expect(headerOf('﻿"Caller, name","Say ""hi""",,Status\r\nx,y,z,w', ',')).toEqual([
      'Caller, name',
      'Say "hi"',
      '',
      'Status',
    ]);
  });
});
