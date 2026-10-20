import { describe, expect, it } from 'vitest';
import { describeRule, formatPercent, mergeRun, plural } from './runs';
import type { CategoryResult, RuleResult } from '../types';

const rule = (id: number, failing: number): RuleResult => ({
  id,
  name: `Rule ${id}`,
  failing,
  percentOk: 100 - failing * 10,
  status: failing ? 'warning' : 'good',
  records: [],
  truncated: false,
});

const result = (rules: RuleResult[], ranAt = '2026-10-20T10:00:00Z'): CategoryResult => ({
  id: 1,
  name: 'Servers',
  ranAt,
  total: 10,
  failing: 3,
  percentOk: 70,
  status: 'bad',
  rules,
});

describe('mergeRun', () => {
  it('replaces a category on a whole run', () => {
    const first = mergeRun({}, result([rule(1, 1), rule(2, 2)]), true);
    const second = mergeRun(first, result([rule(1, 0)]), true);
    expect(Object.keys(second[1]!.rules)).toEqual(['1']);
    expect(second[1]!.summary).toEqual({ failing: 3, percentOk: 70, status: 'bad' });
  });

  it('updates only that rule on a one-rule run, keeping the last overall figure', () => {
    const first = mergeRun({}, result([rule(1, 1), rule(2, 2)]), true);
    const next = mergeRun(first, result([rule(2, 0)], '2026-10-20T11:00:00Z'), false);
    expect(next[1]!.rules[1]!.failing).toBe(1);
    expect(next[1]!.rules[2]!.failing).toBe(0);
    expect(next[1]!.rules[2]!.ranAt).toBe('2026-10-20T11:00:00Z');
    expect(next[1]!.summary?.failing).toBe(3);
  });

  it('has no overall figure until the whole category has run', () => {
    expect(mergeRun({}, result([rule(2, 1)]), false)[1]!.summary).toBeUndefined();
  });

  it('drops the overall figure when the category set could not be read', () => {
    const next = mergeRun({}, { ...result([]), error: 'nope' }, true);
    expect(next[1]!.summary).toBeUndefined();
    expect(next[1]!.error).toBe('nope');
  });
});

describe('formatting', () => {
  it('never shows a failing category as 100%', () => {
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(99.96)).toBe('99.9%');
    expect(formatPercent(0.57)).toBe('0.5%');
    expect(formatPercent(75)).toBe('75%');
  });

  it('pluralises', () => {
    expect(plural(1, 'rule')).toBe('1 rule');
    expect(plural(2, 'rule')).toBe('2 rules');
  });

  it('says how a rule decides', () => {
    const base = { id: 1, name: 'x', description: '' };
    expect(describeRule({ ...base, lists: 'faulty' }, 'Server')).toMatch(/wrong/);
    expect(describeRule({ ...base, lists: 'valid' }, 'Server')).toMatch(/the rest fail/);
  });
});
