/**
 * problems: DTOs. Mirrored by frontend/src/features/problems/types.ts.
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

/* ------------------------------------------------------------------------- *
 * Root-cause evidence (correlation assistant) and the AI draft
 * ------------------------------------------------------------------------- */

/** A record the evidence points at, for a link on screen. */
export interface RecordRef {
  class: string;
  id: string;
  /** The ref (I-000123) or name (SRV-DB-01). */
  label: string;
}

export interface EvidenceIncident {
  id: string;
  ref: string;
  title: string;
  /** iTop's status code. */
  status: string;
  /** ISO instant. */
  startDate: string;
  serviceId: string;
  serviceName: string;
  subcategoryId: string;
  subcategoryName: string;
  cis: Array<{ id: string; name: string }>;
  /** The change the incident is linked to, when there is one. */
  changeId?: string;
  changeRef?: string;
}

export interface SimilarIncident extends EvidenceIncident {
  /** Why it looks related: "same CI SRV-DB-01", "similar title (62%)". */
  matches: string[];
  /** The problem it is linked to already, if any. */
  problemRef?: string;
}

export type CiRole = "affected" | "upstream" | "downstream";

export interface EvidenceCi {
  id: string;
  name: string;
  class: string;
  /**
   * affected: on the problem or one of its incidents. upstream: an affected CI
   * depends on it (iTop's impact relation). downstream: it depends on one.
   */
  role: CiRole;
  /** Linked incidents naming this CI. */
  incidentCount: number;
  /** For upstream and downstream: the affected CI it is related to. */
  via?: string;
}

export interface EvidenceChange {
  id: string;
  ref: string;
  title: string;
  /** NormalChange, EmergencyChange, RoutineChange or Change. */
  class: string;
  status: string;
  /** ISO instants; end may be empty. */
  startDate: string;
  endDate: string;
  /** From the end (or start) of the change to the first incident; negative while it was still running. */
  hoursBeforeFirstIncident: number;
  cis: Array<{ id: string; name: string; role: CiRole }>;
  /** Linked incidents iTop links to this change (Incident.parent_change_id). */
  linkedIncidents: number;
  /** The problem names this change as its related change. */
  relatedToProblem: boolean;
}

export interface EvidenceProblem {
  id: string;
  ref: string;
  title: string;
  status: string;
  startDate: string;
  /** The analysis, when the iTop has the arcus-problem-rca fields and it was recorded. */
  rootCause: string;
  sharedCis: string[];
  sameService: boolean;
}

export interface EvidenceKnownError {
  id: string;
  name: string;
  problemRef: string;
  rootCause: string;
  workaround: string;
  cis: Array<{ id: string; name: string }>;
}

export type CandidateKind = "change" | "ci" | "known_error" | "problem";

/** One likely cause, with the arithmetic behind its score spelled out. */
export interface CandidateCause {
  kind: CandidateKind;
  record: RecordRef;
  /** 0-100. */
  score: number;
  confidence: "high" | "medium" | "low";
  /** One-line headline. */
  summary: string;
  /** Plain-language reasons, each with the points it added. */
  reasons: Array<{ text: string; points: number }>;
  /** Other records the reasons mention. */
  related: RecordRef[];
}

export interface RcaEvidence {
  problemId: string;
  ref: string;
  title: string;
  /** ISO instant. */
  generatedAt: string;
  lookbackHours: number;
  /** The moment changes are measured against: the first linked incident, else the problem's start. */
  anchor: { at: string; source: "incident" | "problem"; ref: string };
  linkedIncidents: EvidenceIncident[];
  similarIncidents: SimilarIncident[];
  cis: EvidenceCi[];
  changes: EvidenceChange[];
  problems: EvidenceProblem[];
  knownErrors: EvidenceKnownError[];
  /** Best first. */
  candidates: CandidateCause[];
  /**
   * Sources the caller could not read (no rights to the class, say), so the
   * screen can say the picture is partial.
   */
  unavailable: Array<{ source: string; reason: string }>;
  /** Whether "Draft with AI" is offered to this caller. */
  ai: { enabled: boolean };
}

export interface RcaEvidenceQuery {
  lookbackHours: number;
}

/** What the AI drafts. Nothing is saved until the problem manager saves it. */
export interface RcaDraft extends RootCauseAnalysis {
  confidence: "high" | "medium" | "low";
  /** Why that confidence, citing the evidence. */
  confidenceNote: string;
  /** Records the draft relies on. */
  citations: RecordRef[];
  /** The model that wrote it. */
  model: string;
  /** Personal data removed before sending: counts by kind. */
  redactions: { emails: number; phones: number };
}

/** Sent with a save when the text started as an AI draft. */
export interface AnalysisSaveInput extends RootCauseAnalysis {
  aiDraft?: { model: string };
}
