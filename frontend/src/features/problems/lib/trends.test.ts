import { describe, expect, it } from 'vitest';
import type { ProblemTrends, TrendGroup } from '../types';
import { chartPoints, linkedShare, sparkPoints, visibleGroups } from './trends';

const group = (name: string, extra: Partial<TrendGroup> = {}): TrendGroup => ({
  key: name,
  name,
  incidents: 4,
  linkedIncidents: 0,
  unlinkedIncidents: 4,
  problems: 0,
  openProblems: 0,
  perBucket: [1, 3],
  activeBuckets: 2,
  recurring: true,
  problemRefs: [],
  ...extra,
});

const trends: ProblemTrends = {
  period: '30d',
  groupBy: 'service',
  from: '2026-09-24',
  to: '2026-10-23',
  bucket: 'week',
  buckets: [
    { start: '2026-10-12', incidents: 2, linkedIncidents: 1, problems: 0 },
    { start: '2026-10-19', incidents: 6, linkedIncidents: 2, problems: 1 },
  ],
  groups: [
    group('Email'),
    group('VPN', { linkedIncidents: 4, unlinkedIncidents: 0 }),
    group('Payroll', { incidents: 1, recurring: false, perBucket: [0, 1], activeBuckets: 1 }),
  ],
  totals: { incidents: 8, linkedIncidents: 3, problems: 1, recurringGroups: 2 },
  recurringRule: { minIncidents: 3, minBuckets: 2 },
  truncated: false,
};

describe('problem trend helpers', () => {
  it('turns buckets into chart rows with readable labels', () => {
    const points = chartPoints(trends);
    expect(points).toHaveLength(2);
    expect(points[1]).toMatchObject({ incidents: 6, linkedIncidents: 2, problems: 1 });
    expect(points[1]!.label).toMatch(/19/);
  });

  it('labels months with the year', () => {
    const monthly = chartPoints({ ...trends, bucket: 'month', buckets: [{ start: '2026-03-01', incidents: 1, linkedIncidents: 0, problems: 0 }] });
    expect(monthly[0]!.label).toMatch(/2026/);
  });

  it('aligns a group sparkline with the buckets', () => {
    expect(sparkPoints(trends.groups[0]!, trends).map((p) => p.value)).toEqual([1, 3]);
  });

  it('gives the linked share as a whole percent, 0 with no incidents', () => {
    expect(linkedShare(trends)).toBe(38);
    expect(linkedShare({ ...trends, totals: { ...trends.totals, incidents: 0, linkedIncidents: 0 } })).toBe(0);
  });

  it('filters to recurring groups, and to those no problem covers', () => {
    expect(visibleGroups(trends, 'all').map((g) => g.name)).toEqual(['Email', 'VPN', 'Payroll']);
    expect(visibleGroups(trends, 'recurring').map((g) => g.name)).toEqual(['Email', 'VPN']);
    expect(visibleGroups(trends, 'unlinked').map((g) => g.name)).toEqual(['Email']);
  });
});
