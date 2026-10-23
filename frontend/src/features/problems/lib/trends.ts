import type { ProblemTrends, TrendGroup, TrendGroupBy, TrendPeriod } from '../types';

export const PERIODS: Array<{ value: TrendPeriod; label: string }> = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 6 months' },
  { value: '365d', label: 'Last 12 months' },
];

export const GROUPINGS: Array<{ value: TrendGroupBy; label: string; noun: string }> = [
  { value: 'service', label: 'By service', noun: 'Service' },
  { value: 'ci', label: 'By configuration item', noun: 'Configuration item' },
  { value: 'category', label: 'By category', noun: 'Category' },
];

/** A bucket's axis label: "Oct 19" for a week, "Oct 2026" for a month. */
export function bucketLabel(start: string, bucket: ProblemTrends['bucket']): string {
  const date = new Date(`${start}T00:00:00`);
  return bucket === 'week'
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Rows for the chart: one per bucket, every series a count of tickets. */
export function chartPoints(trends: ProblemTrends) {
  return trends.buckets.map((b) => ({
    label: bucketLabel(b.start, trends.bucket),
    incidents: b.incidents,
    linkedIncidents: b.linkedIncidents,
    problems: b.problems,
  }));
}

/** One group's incidents per bucket, for its sparkline. */
export function sparkPoints(group: TrendGroup, trends: ProblemTrends) {
  return group.perBucket.map((value, i) => ({
    label: bucketLabel(trends.buckets[i]?.start ?? '', trends.bucket),
    value,
  }));
}

/** Share of incidents already tied to a problem, as a whole percent. */
export function linkedShare(trends: ProblemTrends): number {
  const { incidents, linkedIncidents } = trends.totals;
  return incidents ? Math.round((linkedIncidents / incidents) * 100) : 0;
}

/**
 * The groups to list. "Needs a problem" keeps recurring groups with incidents
 * no problem covers yet: the candidates to open a problem for.
 */
export function visibleGroups(trends: ProblemTrends, filter: 'all' | 'recurring' | 'unlinked') {
  if (filter === 'recurring') return trends.groups.filter((g) => g.recurring);
  if (filter === 'unlinked') return trends.groups.filter((g) => g.recurring && g.unlinkedIncidents > 0);
  return trends.groups;
}
