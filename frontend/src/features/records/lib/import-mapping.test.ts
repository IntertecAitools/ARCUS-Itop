import { describe, expect, it } from 'vitest';
import type { ClassInfo } from '../types';
import {
  importTargets,
  isIdentityMapping,
  isImportColumn,
  mappedColumns,
  needsMapping,
  suggestMapping,
} from './import-mapping';

/** A slice of UserRequest: scalars, two pickers, a case log and a read-only field. */
const info = {
  name: 'UserRequest',
  writable: ['title', 'description', 'org_id', 'caller_id', 'urgency', 'public_log'],
  fields: {
    ref: { type: 'String', ui: 'readonly' },
    title: { type: 'String', ui: 'scalar' },
    description: { type: 'Text', ui: 'scalar' },
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
    caller_id: { type: 'ExternalKey', ui: 'picker', target: 'Person' },
    urgency: { type: 'Enum', ui: 'scalar' },
    public_log: { type: 'CaseLog', ui: 'scalar' },
  },
  labels: {
    class: 'User Request',
    fields: {
      ref: 'Ref',
      title: 'Title',
      description: 'Description',
      org_id: 'Organization',
      caller_id: 'Caller',
      urgency: 'Urgency',
      public_log: 'Public log',
    },
    values: {},
  },
} as unknown as ClassInfo;

describe('import targets', () => {
  it('offers id, writable fields, and a picker by name or by id; never a case log', () => {
    const values = importTargets(info).map((t) => t.value);
    expect(values).toEqual([
      'id',
      'title',
      'description',
      'org_id->friendlyname',
      'org_id',
      'caller_id->friendlyname',
      'caller_id',
      'urgency',
    ]);
    expect(importTargets(info).find((t) => t.value === 'org_id->friendlyname')?.label).toBe('Organization (name)');
  });
});

describe('isImportColumn / needsMapping', () => {
  it('accepts codes, id and a picker path', () => {
    expect(isImportColumn(info, 'title')).toBe(true);
    expect(isImportColumn(info, 'id')).toBe(true);
    expect(isImportColumn(info, 'org_id->name')).toBe(true);
  });

  it('rejects labels and a path on a non-picker', () => {
    expect(isImportColumn(info, 'Title')).toBe(false);
    expect(isImportColumn(info, 'title->x')).toBe(false);
    expect(needsMapping(info, ['title', 'Organization'])).toBe(true);
    expect(needsMapping(info, ['title', 'org_id'])).toBe(false);
  });
});

describe('suggestMapping', () => {
  it('keeps headings that already are columns', () => {
    const headings = ['id', 'title', 'org_id->name'];
    const mapping = suggestMapping(info, headings);
    expect(mapping).toEqual(headings);
    expect(isIdentityMapping(headings, mapping)).toBe(true);
  });

  it('matches labels and codes regardless of case, spaces and punctuation', () => {
    expect(suggestMapping(info, ['Title', 'DESCRIPTION', 'Ur-gency', 'ID'])).toEqual([
      'title',
      'description',
      'urgency',
      'id',
    ]);
  });

  it('maps a file exported from the list back onto its fields', () => {
    expect(suggestMapping(info, ['id (Primary Key)', 'Ref', 'Title', 'Organization', 'Urgency'])).toEqual([
      'id',
      null,
      'title',
      'org_id->friendlyname',
      'urgency',
    ]);
  });

  it('matches a picker by label to the name of what it points at, and by code to its id', () => {
    expect(suggestMapping(info, ['Organization', 'Caller'])).toEqual(['org_id->friendlyname', 'caller_id->friendlyname']);
    expect(suggestMapping(info, ['ORG_ID'])).toEqual(['org_id']);
    expect(suggestMapping(info, ['Organization (ID)', 'Caller (name)'])).toEqual(['org_id', 'caller_id->friendlyname']);
  });

  it('reads "Label->Name" headings as a match on the name', () => {
    expect(suggestMapping(info, ['Caller->Name', 'Caller->Email'])).toEqual(['caller_id->name', null]);
  });

  it('skips what it cannot place, read-only fields and second uses of a field', () => {
    expect(suggestMapping(info, ['Ref', 'Notes', 'Title', 'title '])).toEqual([null, null, 'title', null]);
  });

  it('lists only mapped columns for the next steps', () => {
    const mapping = suggestMapping(info, ['Title', 'Notes', 'Organization']);
    expect(mappedColumns(mapping)).toEqual(['title', 'org_id->friendlyname']);
    expect(isIdentityMapping(['Title', 'Notes', 'Organization'], mapping)).toBe(false);
  });
});
