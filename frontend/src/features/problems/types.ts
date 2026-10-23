/**
 * problems: DTOs. Mirrors backend/src/modules/problems/problems.types.ts; keep the two identical.
 */

/**
 * The three answers a root-cause analysis gives. Empty string = not known yet.
 * In iTop: Problem.root_cause, workaround and solution (arcus-problem-rca).
 */
export interface RootCauseAnalysis {
  rootCause: string;
  workaround: string;
  resolution: string;
}

export interface KnownErrorSummary {
  id: string;
  name: string;
}

export interface ProblemAnalysis extends RootCauseAnalysis {
  problemId: string;
  ref: string;
  title: string;
  /** iTop's own status code: new, assigned, resolved, closed. */
  status: string;
  /**
   * False when the iTop lacks the arcus-problem-rca extension: the fields
   * are then always empty and cannot be saved.
   */
  available: boolean;
  /** Known errors raised from this problem. */
  knownErrors: KnownErrorSummary[];
}

export type KnownErrorDomain = "Application" | "Desktop" | "Network" | "Server";

export interface CreateKnownErrorInput {
  /** Defaults to "<ref>: <title>". */
  name?: string;
  /** What users see. Defaults to the problem's description as plain text. */
  symptom?: string;
  domain?: KnownErrorDomain;
  errorCode?: string;
}

export interface KnownErrorCreated extends KnownErrorSummary {
  problemId: string;
  /** Configuration items copied from the problem. */
  linkedCis: number;
}

/* ------------------------------------------------------------------------- *
 * Trends
 * ------------------------------------------------------------------------- */

export type TrendPeriod = "30d" | "90d" | "180d" | "365d";
export type TrendGroupBy = "service" | "ci" | "category";

export interface TrendQuery {
  period: TrendPeriod;
  groupBy: TrendGroupBy;
}

export interface TrendBucket {
  /** First day of the week (Monday) or month, YYYY-MM-DD on iTop's clock. */
  start: string;
  incidents: number;
  /** Incidents in this bucket that are linked to a problem. */
  linkedIncidents: number;
  /** Problems opened in this bucket. */
  problems: number;
}

export interface TrendGroup {
  /** Stable key: the service/CI/category id, or "none". */
  key: string;
  name: string;
  incidents: number;
  linkedIncidents: number;
  unlinkedIncidents: number;
  /** Problems opened in the period in this group. */
  problems: number;
  openProblems: number;
  /** Incidents per bucket, aligned with `ProblemTrends.buckets`. */
  perBucket: number[];
  /** Buckets with at least one incident. */
  activeBuckets: number;
  lastIncidentAt?: string;
  /** Keeps coming back: enough incidents, spread over more than one bucket. */
  recurring: boolean;
  /** Problems this group's incidents are linked to, or that were opened in it. */
  problemRefs: Array<{ id: string; ref: string }>;
}

export interface ProblemTrends {
  period: TrendPeriod;
  groupBy: TrendGroupBy;
  /** YYYY-MM-DD, inclusive, on iTop's clock. */
  from: string;
  to: string;
  bucket: "week" | "month";
  buckets: TrendBucket[];
  /** Most incidents first. */
  groups: TrendGroup[];
  totals: {
    incidents: number;
    linkedIncidents: number;
    problems: number;
    recurringGroups: number;
  };
  /** The recurring rule, so the screen can say what "recurring" means. */
  recurringRule: { minIncidents: number; minBuckets: number };
  /** More records than the trend reads; the counts are a lower bound. */
  truncated: boolean;
}
