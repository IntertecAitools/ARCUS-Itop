import { addDays, itopDay, weekday } from "../../shared/itop-time.js";
import type {
  ProblemTrends,
  TrendBucket,
  TrendGroup,
  TrendGroupBy,
  TrendPeriod,
} from "./problems.types.js";

/**
 * The trend view's arithmetic, kept free of iTop calls so it can be tested on
 * plain rows.
 */

export const PERIOD_DAYS: Record<TrendPeriod, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

/** A group "keeps coming back" with this many incidents over this many buckets. */
export const RECURRING_RULE = { minIncidents: 3, minBuckets: 2 };

/** Problems listed per group in the table; the count says the rest. */
const PROBLEM_REFS_PER_GROUP = 5;

/** The fields of an Incident or Problem row the trend reads. */
export interface TrendRow {
  id: string;
  ref: string;
  /** ISO instant. */
  startDate: string;
  status?: string;
  serviceId: string;
  serviceName: string;
  categoryId: string;
  categoryName: string;
  cis: Array<{ id: string; name: string }>;
  /** Incidents only: the problem it is linked to ("" or "0" when none). */
  problemId?: string;
  problemRef?: string;
}

export const bucketKind = (period: TrendPeriod): "week" | "month" =>
  PERIOD_DAYS[period] <= 90 ? "week" : "month";

/** The first day of the week (Monday) or month a day falls in. */
export function bucketStart(day: string, kind: "week" | "month"): string {
  if (kind === "month") return `${day.slice(0, 7)}-01`;
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** Every bucket from the one holding `from` to the one holding `to`. */
export function bucketStarts(from: string, to: string, kind: "week" | "month"): string[] {
  const starts: string[] = [];
  let cursor = bucketStart(from, kind);
  const last = bucketStart(to, kind);
  while (cursor <= last) {
    starts.push(cursor);
    if (kind === "week") {
      cursor = addDays(cursor, 7);
    } else {
      const [y, m] = cursor.split("-").map(Number);
      cursor = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
    }
  }
  return starts;
}

/** The first day of the window: `days` days ending today, today included. */
export const windowStart = (today: string, period: TrendPeriod) =>
  addDays(today, -(PERIOD_DAYS[period] - 1));

const OPEN_PROBLEM = new Set(["new", "assigned"]);

const linked = (row: TrendRow) => Boolean(row.problemId && row.problemId !== "0");

/** The groups a row counts towards. A ticket on two CIs counts for both. */
function groupsOf(row: TrendRow, groupBy: TrendGroupBy): Array<{ key: string; name: string }> {
  const one = (id: string, name: string, none: string) =>
    id && id !== "0" ? [{ key: id, name: name || `#${id}` }] : [{ key: "none", name: none }];
  if (groupBy === "service") return one(row.serviceId, row.serviceName, "No service");
  if (groupBy === "category") return one(row.categoryId, row.categoryName, "No category");
  const seen = new Map<string, string>();
  for (const ci of row.cis) if (ci.id && ci.id !== "0") seen.set(ci.id, ci.name || `#${ci.id}`);
  return seen.size
    ? [...seen].map(([key, name]) => ({ key, name }))
    : [{ key: "none", name: "No configuration item" }];
}

export interface BuildTrendsInput {
  period: TrendPeriod;
  groupBy: TrendGroupBy;
  /** Today, YYYY-MM-DD on iTop's clock. */
  today: string;
  timeZone: string;
  incidents: TrendRow[];
  problems: TrendRow[];
  truncated: boolean;
}

export function buildTrends(input: BuildTrendsInput): ProblemTrends {
  const { period, groupBy, today, timeZone } = input;
  const kind = bucketKind(period);
  const from = windowStart(today, period);
  const starts = bucketStarts(from, today, kind);
  const slot = new Map(starts.map((start, i) => [start, i]));

  /** The bucket index of a row, or undefined outside the window. */
  const indexOf = (row: TrendRow): number | undefined => {
    const instant = new Date(row.startDate);
    if (Number.isNaN(instant.getTime())) return undefined;
    const day = itopDay(instant, timeZone);
    if (day < from || day > today) return undefined;
    return slot.get(bucketStart(day, kind));
  };

  const buckets: TrendBucket[] = starts.map((start) => ({
    start,
    incidents: 0,
    linkedIncidents: 0,
    problems: 0,
  }));

  interface Acc {
    group: TrendGroup;
    refs: Map<string, string>;
  }
  const groups = new Map<string, Acc>();
  const groupFor = (key: string, name: string): Acc => {
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        group: {
          key,
          name,
          incidents: 0,
          linkedIncidents: 0,
          unlinkedIncidents: 0,
          problems: 0,
          openProblems: 0,
          perBucket: starts.map(() => 0),
          activeBuckets: 0,
          recurring: false,
          problemRefs: [],
        },
        refs: new Map(),
      };
      groups.set(key, acc);
    }
    return acc;
  };

  let incidents = 0;
  let linkedIncidents = 0;
  for (const row of input.incidents) {
    const index = indexOf(row);
    if (index === undefined) continue;
    const isLinked = linked(row);
    incidents += 1;
    buckets[index]!.incidents += 1;
    if (isLinked) {
      linkedIncidents += 1;
      buckets[index]!.linkedIncidents += 1;
    }
    for (const { key, name } of groupsOf(row, groupBy)) {
      const acc = groupFor(key, name);
      const g = acc.group;
      g.incidents += 1;
      g.perBucket[index]! += 1;
      if (isLinked) {
        g.linkedIncidents += 1;
        acc.refs.set(row.problemId!, row.problemRef || `#${row.problemId}`);
      } else {
        g.unlinkedIncidents += 1;
      }
      if (!g.lastIncidentAt || row.startDate > g.lastIncidentAt) g.lastIncidentAt = row.startDate;
    }
  }

  let problems = 0;
  for (const row of input.problems) {
    const index = indexOf(row);
    if (index === undefined) continue;
    problems += 1;
    buckets[index]!.problems += 1;
    for (const { key, name } of groupsOf(row, groupBy)) {
      const acc = groupFor(key, name);
      acc.group.problems += 1;
      if (OPEN_PROBLEM.has(row.status ?? "")) acc.group.openProblems += 1;
      acc.refs.set(row.id, row.ref || `#${row.id}`);
    }
  }

  const list = [...groups.values()].map(({ group, refs }) => {
    group.activeBuckets = group.perBucket.filter((n) => n > 0).length;
    group.recurring =
      group.incidents >= RECURRING_RULE.minIncidents && group.activeBuckets >= RECURRING_RULE.minBuckets;
    group.problemRefs = [...refs]
      .slice(0, PROBLEM_REFS_PER_GROUP)
      .map(([id, ref]) => ({ id, ref }));
    return group;
  });

  // Most incidents first; among equals, the recurring one, then by name.
  list.sort(
    (a, b) =>
      b.incidents - a.incidents ||
      Number(b.recurring) - Number(a.recurring) ||
      b.problems - a.problems ||
      a.name.localeCompare(b.name),
  );

  return {
    period,
    groupBy,
    from,
    to: today,
    bucket: kind,
    buckets,
    groups: list,
    totals: {
      incidents,
      linkedIncidents,
      problems,
      recurringGroups: list.filter((g) => g.recurring).length,
    },
    recurringRule: RECURRING_RULE,
    truncated: input.truncated,
  };
}
