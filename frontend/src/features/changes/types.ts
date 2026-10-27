/**
 * changes: DTOs. Mirrors backend/src/modules/changes/changes.types.ts; keep the two identical.
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
