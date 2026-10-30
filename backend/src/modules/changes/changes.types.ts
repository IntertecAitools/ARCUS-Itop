/**
 * changes: DTOs. Mirrored by frontend/src/features/changes/types.ts.
 */

/** iTop's three change classes: RoutineChange, NormalChange, EmergencyChange. */
export type ChangeType = "routine" | "normal" | "emergency";

/**
 * The plans a change can carry. In iTop: Change.implementation_plan and
 * test_plan (arcus-change-cab extension), and iTop's own Change.fallback.
 */
export type PlanKind = "implementation" | "rollback" | "test";

export interface ChangePlans {
  implementation: string;
  rollback: string;
  test: string;
}

/**
 * When a plan must be written: before the change can be planned ("plan"),
 * before it can be implemented ("implement"), or never ("optional").
 * Required at plan means required at implement too.
 */
export type PlanRequirement = "plan" | "implement" | "optional";

export type PlanRules = Record<ChangeType, Record<PlanKind, PlanRequirement>>;

export interface PlanRulesDto {
  rules: PlanRules;
  /** The rules a fresh platform starts with. */
  defaults: PlanRules;
  /** ISO time and login of the last edit; empty while the defaults apply. */
  updatedAt: string;
  updatedBy: string;
}

export type CabDecisionValue = "approved" | "rejected" | "deferred";

export interface CabDecision {
  id: string;
  /** ISO time of the CAB meeting. */
  meetingDate: string;
  /** One attendee per line. */
  attendees: string[];
  decision: CabDecisionValue;
  conditions: string;
  notes: string;
  recordedBy: string;
  /** ISO time the decision was recorded. */
  recordedAt: string;
}

export interface CabDecisionInput {
  /** ISO date-time, or YYYY-MM-DD. */
  meetingDate: string;
  attendees: string[];
  decision: CabDecisionValue;
  conditions: string;
  notes: string;
}

/** Our name for a change's lifecycle state (iTop's codes stay in the BFF). */
export type ChangeStatus =
  | "new"
  | "validated"
  | "rejected"
  | "assigned"
  | "planned"
  | "approved"
  | "not_approved"
  | "implemented"
  | "monitored"
  | "closed";

/** The two lifecycle steps plans are checked at. */
export type PlanGate = "plan" | "implement";

export interface ChangeGovernance {
  changeId: string;
  ref: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  /**
   * False when the iTop lacks the arcus-change-cab extension: the
   * implementation and test plans and CAB decisions cannot be kept there.
   */
  available: boolean;
  plans: ChangePlans;
  /** This change type's rule for each plan. */
  requirements: Record<PlanKind, PlanRequirement>;
  /** Plans still missing for each gate. */
  missing: Record<PlanGate, PlanKind[]>;
  cab: {
    /** Normal and emergency changes go to the CAB; routine ones never do. */
    required: boolean;
    /** Planned and waiting for an approve / not-approve decision. */
    awaiting: boolean;
    /** The caller holds Change Approver (or Administrator), and the change is awaiting. */
    canDecide: boolean;
    /** Newest first. */
    decisions: CabDecision[];
  };
}

export interface CabQueueItem {
  id: string;
  ref: string;
  title: string;
  type: ChangeType;
  organization: string;
  /** ISO, or "" when not scheduled. */
  startDate: string;
  endDate: string;
  outage: boolean;
  impact: string;
  /** The newest decision, when the CAB already looked at it (deferred). */
  lastDecision?: { decision: CabDecisionValue; meetingDate: string };
  /** Plans still missing to implement the change once approved. */
  missingPlans: PlanKind[];
}

export interface CabQueue {
  items: CabQueueItem[];
  available: boolean;
}

/* ------------------------------------------------------------------------- *
 * Calendar and blackout windows
 * ------------------------------------------------------------------------- */

export interface NamedRef {
  id: string;
  name: string;
}

/** A period an administrator closes to changes (a freeze). Kept by the BFF. */
export interface Blackout {
  id: string;
  name: string;
  /** ISO instants. */
  start: string;
  end: string;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

export interface BlackoutInput {
  name: string;
  start: string;
  end: string;
  reason: string;
}

/** Another change on the same CI or service at an overlapping time. */
export interface ChangeClash {
  changeId: string;
  ref: string;
  /** What both touch. */
  on: Array<{ kind: "ci" | "service"; name: string }>;
}

export interface CalendarChange {
  id: string;
  ref: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  /** ISO; `end` is "" when the change has no planned end. */
  start: string;
  end: string;
  organization: NamedRef;
  team: NamedRef | null;
  cis: NamedRef[];
  services: NamedRef[];
  outage: boolean;
  /** The risk level from the questionnaire, when it was answered. */
  risk: RiskLevel | null;
  clashes: ChangeClash[];
  /** Blackout windows the change overlaps. */
  blackouts: NamedRef[];
}

export interface ChangeCalendar {
  /** The window asked for, ISO. */
  from: string;
  to: string;
  items: CalendarChange[];
  /** Blackout windows overlapping the window. */
  blackouts: Blackout[];
  /** Every value the filters can take in this window (before filtering). */
  options: { teams: NamedRef[]; cis: NamedRef[]; services: NamedRef[]; organizations: NamedRef[] };
  /** More changes fall in the window than the calendar reads. */
  truncated: boolean;
}

export interface CalendarQuery {
  from: string;
  to: string;
  teamId?: string;
  ciId?: string;
  serviceId?: string;
  orgId?: string;
}

/* ------------------------------------------------------------------------- *
 * Risk questionnaire
 * ------------------------------------------------------------------------- */

export type RiskLevel = "low" | "medium" | "high";

export interface RiskOption {
  id: string;
  label: string;
  /** 0 (no risk) to 10 (most risk). */
  score: number;
}

export interface RiskQuestion {
  id: string;
  text: string;
  help: string;
  /** 1 to 10: how much this question counts. */
  weight: number;
  options: RiskOption[];
}

export interface RiskModel {
  questions: Record<ChangeType, RiskQuestion[]>;
  /** Score (0–100) at which a change is medium, and high, risk. */
  thresholds: { medium: number; high: number };
  /** The questionnaire must be answered before the change is planned. */
  requiredBeforePlan: Record<ChangeType, boolean>;
}

export interface RiskModelDto {
  model: RiskModel;
  defaults: RiskModel;
  updatedAt: string;
  updatedBy: string;
}

export interface RiskAssessment {
  changeId: string;
  ref: string;
  type: ChangeType;
  status: ChangeStatus;
  /** This change type's questions, as they are now. */
  questions: RiskQuestion[];
  /** Question id -> option id. */
  answers: Record<string, string>;
  /** 0–100, null until every question is answered. */
  score: number | null;
  level: RiskLevel | null;
  thresholds: { medium: number; high: number };
  assessedBy: string;
  /** ISO; "" until answered. */
  assessedAt: string;
  /** The answers no longer cover the questions (an administrator changed them). */
  stale: boolean;
  /** Must be answered before planning (the administrator's setting for this type). */
  required: boolean;
  /**
   * High risk on a routine change: it cannot go ahead as pre-approved and must
   * be raised as a normal change, which goes to the CAB.
   */
  forcesCab: boolean;
  /** The caller may answer (the change is not yet implemented). */
  canEdit: boolean;
}

export interface RiskAnswersInput {
  answers: Record<string, string>;
}

/* ------------------------------------------------------------------------- *
 * Post-implementation review
 * ------------------------------------------------------------------------- */

export type PirOutcome = "successful" | "partial" | "failed" | "rolled_back";

export interface PirFollowUp {
  text: string;
  owner: string;
  /** YYYY-MM-DD or "". */
  due: string;
  done: boolean;
}

export interface PirIncident {
  id: string;
  ref: string;
  title: string;
}

export interface PirReview {
  outcome: PirOutcome;
  wentWell: string;
  wentBadly: string;
  incidents: PirIncident[];
  followUps: PirFollowUp[];
  completedBy: string;
  completedAt: string;
}

export interface ChangePir {
  changeId: string;
  ref: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  /** Implemented, monitored or closed: a review can be written. */
  allowed: boolean;
  /** Allowed and not written yet. */
  due: boolean;
  review: PirReview | null;
}

export interface PirInput {
  outcome: PirOutcome;
  wentWell: string;
  wentBadly: string;
  /** Incident refs (I-000123) or ids. */
  incidents: string[];
  followUps: PirFollowUp[];
}

export interface PirDueItem {
  id: string;
  ref: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  organization: string;
  team: string;
  /** ISO planned end, or "". */
  endDate: string;
  /** ISO close date, or "". */
  closedAt: string;
}

export interface PirQueue {
  items: PirDueItem[];
  /** Closed changes older than this many days no longer ask for a review. */
  lookbackDays: number;
}
