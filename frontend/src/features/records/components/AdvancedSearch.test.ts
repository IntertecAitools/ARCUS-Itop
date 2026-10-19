import { describe, expect, it } from 'vitest';
import { isComplete } from './AdvancedSearch';

describe('isComplete', () => {
  it('needs no value for empty / not empty', () => {
    expect(isComplete({ field: 'name', op: 'empty' }, 'string')).toBe(true);
  });
  it('needs at least one choice for an enum or a picker', () => {
    expect(isComplete({ field: 'status', op: 'in', values: [] }, 'enum')).toBe(false);
    expect(isComplete({ field: 'org_id', op: 'in', values: ['3'] }, 'key')).toBe(true);
  });
  it('needs both bounds for between', () => {
    expect(isComplete({ field: 'nb_u', op: 'between', value: '1' }, 'number')).toBe(false);
    expect(isComplete({ field: 'nb_u', op: 'between', value: '1', value2: '4' }, 'number')).toBe(true);
  });
});
