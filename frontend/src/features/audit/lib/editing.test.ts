import { describe, expect, it } from 'vitest';
import { deleteCategoryQuestion, parseRunParam, runParam, toleranceProblem } from './editing';

describe('run parameter', () => {
  it('round-trips a category or rule', () => {
    expect(parseRunParam(runParam({ kind: 'category', id: 10 }))).toEqual({ kind: 'category', id: 10 });
    expect(parseRunParam('rule:7')).toEqual({ kind: 'rule', id: 7 });
  });
  it('ignores anything else', () => {
    expect(parseRunParam(null)).toBeNull();
    expect(parseRunParam('domain:1')).toBeNull();
    expect(parseRunParam('rule:x')).toBeNull();
  });
});

describe('toleranceProblem', () => {
  it('accepts whole percentages with warning at least good', () => {
    expect(toleranceProblem(5, 25)).toBeNull();
    expect(toleranceProblem(0, 0)).toBeNull();
    expect(toleranceProblem(100, 100)).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(toleranceProblem(30, 10)).toMatch(/at least the good/);
    expect(toleranceProblem(-1, 10)).toMatch(/0 to 100/);
    expect(toleranceProblem(5, 101)).toMatch(/0 to 100/);
    expect(toleranceProblem(Number.NaN, 10)).toMatch(/0 to 100/);
  });
});

describe('deleteCategoryQuestion', () => {
  it('names the rules that go with the category', () => {
    expect(deleteCategoryQuestion({ name: 'Servers', rules: [] })).toBe('Delete the category “Servers”?');
    expect(deleteCategoryQuestion({ name: 'Servers', rules: [{ name: 'Has a serial' }] })).toBe(
      'Delete the category “Servers”? Its rule goes with it:\n• Has a serial',
    );
    expect(deleteCategoryQuestion({ name: 'S', rules: [{ name: 'a' }, { name: 'b' }] })).toMatch(/Its 2 rules go with it:\n• a\n• b$/);
  });
});
