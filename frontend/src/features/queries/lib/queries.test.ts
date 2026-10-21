import { describe, expect, it } from 'vitest';
import type { ClassInfo } from '@/features/records';
import type { SavedQuery } from '../types';
import { describeQuery, draftOf, draftProblem, fileStem, resultColumns, resultFields, toInput } from './queries';

const info = {
  name: 'Server',
  fields: {
    name: { type: 'String', ui: 'scalar' },
    status: { type: 'Enum', ui: 'scalar', values: ['production'] },
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
  },
  writable: ['name', 'status', 'org_id'],
  presentation: { list: ['name', 'org_id'] },
  criteria: {
    name: { kind: 'string' },
    status: { kind: 'enum' },
    org_id: { kind: 'key' },
  },
} as unknown as ClassInfo;

const saved = (over: Partial<SavedQuery> = {}): SavedQuery => ({
  id: 1,
  name: 'Production servers',
  description: '',
  recordType: 'Server',
  recordTypeLabel: 'Server',
  mode: 'conditions',
  conditions: [],
  valueLabels: {},
  columns: [],
  parameters: [],
  runnable: true,
  template: false,
  owner: null,
  canEdit: true,
  ...over,
});

describe('toInput', () => {
  it('sends conditions without half-filled rows', () => {
    const draft = {
      ...draftOf(undefined, 'Server'),
      name: ' Prod ',
      conditions: [
        { field: 'status', op: 'in' as const, values: ['production'] },
        { field: 'name', op: 'contains' as const, value: '' },
      ],
    };
    expect(toInput(draft, info)).toEqual({
      name: 'Prod',
      description: '',
      recordType: 'Server',
      conditions: [{ field: 'status', op: 'in', values: ['production'] }],
    });
  });

  it('sends only the query text and columns when written as OQL', () => {
    const draft = { ...draftOf(saved({ mode: 'oql', oql: 'q' }), 'Server'), columns: ['name'] };
    expect(toInput(draft, info)).toEqual({ name: 'Production servers', description: '', oql: 'q', columns: ['name'] });
  });
});

describe('draftProblem', () => {
  it('needs a name to save, not to run', () => {
    const draft = draftOf(undefined, 'Server');
    expect(draftProblem(draft, true)).toMatch(/name/);
    expect(draftProblem(draft, false)).toBeNull();
    expect(draftProblem({ ...draft, mode: 'oql' }, false)).toMatch(/Write/);
  });
});

describe('result columns', () => {
  it("uses the query's columns, else the record type's list columns", () => {
    expect(resultColumns(['status', 'gone'], info)).toEqual(['status']);
    expect(resultColumns([], info)).toEqual(['name', 'org_id']);
  });

  it('asks for the id and each picker by name', () => {
    expect(resultFields(info, ['name', 'org_id'])).toBe('id,name,org_id,org_id_friendlyname');
  });
});

describe('describeQuery', () => {
  it('says what defines a query', () => {
    expect(describeQuery(saved())).toBe('Every record');
    expect(describeQuery(saved({ conditions: [{ field: 'name', op: 'empty' }] }))).toBe('1 condition');
    expect(describeQuery(saved({ mode: 'oql' }))).toMatch(/query language/);
    expect(describeQuery(saved({ parameters: ['this->id'], runnable: false }))).toMatch(/notifications/);
    expect(describeQuery(saved({ recordType: '', recordTypeLabel: 'Person' }))).toMatch(/Person/);
  });
});

describe('fileStem', () => {
  it('makes a file name of a query name', () => {
    expect(fileStem('Open requests: my team!')).toBe('Open-requests-my-team');
    expect(fileStem('***')).toBe('query');
  });
});
