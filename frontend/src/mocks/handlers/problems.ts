import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  ProblemAnalysis,
  ProblemTrends,
  RootCauseAnalysis,
  TrendGroupBy,
  TrendPeriod,
} from '@/features/problems';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock problem management: the analysis of any problem id, known errors
 * raised from it, and a small recurring-incident trend.
 *
 * The store is mutable, so a save or a new known error shows up on the next
 * read, the way the real BFF behaves. Problem 999 answers as an iTop without
 * the arcus-problem-rca extension.
 */
const WITHOUT_EXTENSION = '999';
const analyses = new Map<string, ProblemAnalysis>();
let nextKnownError = 100;

function analysisOf(id: string): ProblemAnalysis {
  let a = analyses.get(id);
  if (!a) {
    a = {
      problemId: id,
      ref: `P-${id.padStart(6, '0')}`,
      title: 'Mail queue stalls every Monday',
      status: 'assigned',
      available: id !== WITHOUT_EXTENSION,
      rootCause: '',
      workaround: '',
      resolution: '',
      knownErrors: [],
    };
    analyses.set(id, a);
  }
  return a;
}

const DAYS: Record<TrendPeriod, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };

/** `weights` cycle over the buckets; an empty list is one incident, in the last bucket. */
const GROUPS: Record<TrendGroupBy, Array<{ key: string; name: string; weights: number[]; linked: number }>> = {
  service: [
    { key: '1', name: 'Email', weights: [2, 0, 3, 1, 2], linked: 3 },
    { key: '2', name: 'VPN', weights: [0, 1, 0, 1, 1], linked: 0 },
    { key: '3', name: 'Payroll', weights: [], linked: 0 },
  ],
  ci: [
    { key: '7', name: 'mail-01', weights: [2, 0, 2, 1, 2], linked: 3 },
    { key: '8', name: 'vpn-gw-02', weights: [0, 1, 0, 1, 1], linked: 0 },
    { key: 'none', name: 'No configuration item', weights: [], linked: 0 },
  ],
  category: [
    { key: '5', name: 'Mailbox access', weights: [1, 0, 2, 1, 1], linked: 2 },
    { key: '6', name: 'Remote access', weights: [0, 1, 0, 1, 1], linked: 0 },
    { key: 'none', name: 'No category', weights: [1, 0, 2, 0, 1], linked: 1 },
  ],
};

function trends(period: TrendPeriod, groupBy: TrendGroupBy): ProblemTrends {
  const bucket = DAYS[period] <= 90 ? 'week' : 'month';
  const today = new Date();
  const count = bucket === 'week' ? Math.ceil(DAYS[period] / 7) : Math.ceil(DAYS[period] / 30);
  const starts = Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    if (bucket === 'week') d.setDate(d.getDate() - 7 * (count - 1 - i));
    else d.setMonth(d.getMonth() - (count - 1 - i), 1);
    return d.toISOString().slice(0, 10);
  });

  const groups = GROUPS[groupBy].map((g) => {
    const perBucket = starts.map((_, i) =>
      g.weights.length ? (g.weights[i % g.weights.length] ?? 0) : Number(i === starts.length - 1),
    );
    const incidents = perBucket.reduce((a, b) => a + b, 0);
    const activeBuckets = perBucket.filter(Boolean).length;
    return {
      key: g.key,
      name: g.name,
      incidents,
      linkedIncidents: g.linked,
      unlinkedIncidents: incidents - g.linked,
      problems: g.linked ? 1 : 0,
      openProblems: g.linked ? 1 : 0,
      perBucket,
      activeBuckets,
      lastIncidentAt: today.toISOString(),
      recurring: incidents >= 3 && activeBuckets >= 2,
      problemRefs: g.linked ? [{ id: '35', ref: 'P-000035' }] : [],
    };
  });

  const buckets = starts.map((start, i) => ({
    start,
    incidents: groups.reduce((sum, g) => sum + (g.perBucket[i] ?? 0), 0),
    linkedIncidents: i % 2 ? 1 : 0,
    problems: i === starts.length - 1 ? 1 : 0,
  }));

  return {
    period,
    groupBy,
    from: starts[0]!,
    to: today.toISOString().slice(0, 10),
    bucket,
    buckets,
    groups: groups.sort((a, b) => b.incidents - a.incidents),
    totals: {
      incidents: buckets.reduce((s, b) => s + b.incidents, 0),
      linkedIncidents: buckets.reduce((s, b) => s + b.linkedIncidents, 0),
      problems: buckets.reduce((s, b) => s + b.problems, 0),
      recurringGroups: groups.filter((g) => g.recurring).length,
    },
    recurringRule: { minIncidents: 3, minBuckets: 2 },
    truncated: false,
  };
}

export const problemHandlers = [
  http.get(url('/problems/trends'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const period = (params.get('period') ?? '90d') as TrendPeriod;
    const groupBy = (params.get('groupBy') ?? 'service') as TrendGroupBy;
    return HttpResponse.json(trends(period, groupBy));
  }),

  http.get(url('/problems/:id/analysis'), ({ params }) =>
    HttpResponse.json(analysisOf(String(params.id))),
  ),

  http.put(url('/problems/:id/analysis'), async ({ params, request }) => {
    const body = (await request.json()) as RootCauseAnalysis;
    const current = analysisOf(String(params.id));
    if (!current.available) {
      return HttpResponse.json(
        { error: { code: 'conflict', message: 'This iTop has no root-cause fields on problems: install the arcus-problem-rca extension.' } },
        { status: 409 },
      );
    }
    const next: ProblemAnalysis = {
      ...current,
      rootCause: body.rootCause.trim(),
      workaround: body.workaround.trim(),
      resolution: body.resolution.trim(),
    };
    analyses.set(current.problemId, next);
    return HttpResponse.json(next);
  }),

  http.post(url('/problems/:id/known-errors'), async ({ params, request }) => {
    const body = (await request.json()) as { name?: string };
    const current = analysisOf(String(params.id));
    if (!current.rootCause && !current.workaround) {
      return HttpResponse.json(
        { error: { code: 'bad_request', message: 'Record the root cause or a workaround before raising a known error.' } },
        { status: 400 },
      );
    }
    const created = {
      id: String(nextKnownError++),
      name: body.name || `${current.ref}: ${current.title}`,
      problemId: current.problemId,
      linkedCis: 0,
    };
    analyses.set(current.problemId, {
      ...current,
      knownErrors: [...current.knownErrors, { id: created.id, name: created.name }],
    });
    return HttpResponse.json(created, { status: 201 });
  }),
];
