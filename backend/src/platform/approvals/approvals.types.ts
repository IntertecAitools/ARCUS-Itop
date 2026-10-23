/**
 * Approvals DTOs. Mirrored by frontend/src/features/approvals/types.ts.
 *
 * An approval is one request waiting on (or decided by) one or two levels of
 * approvers, as iTop's approval extension runs it. None of iTop's own terms
 * (scheme, step, passcode, Person::id) reach the frontend.
 */

/** Where the whole approval stands. */
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalDecision = "approved" | "rejected";

/** One approver's place in a level. */
export interface ApprovalAnswer {
  name: string;
  decision: ApprovalDecision | null;
  comment: string;
  /** ISO instant of the answer; "" until there is one. */
  at: string;
  /** A substitute who answered in the approver's place; "" otherwise. */
  answeredBy: string;
}

export interface ApprovalLevel {
  /** 1-based. */
  level: number;
  /** waiting: not reached yet; in_progress: answers awaited. */
  status: "waiting" | "in_progress" | "approved" | "rejected";
  approvers: ApprovalAnswer[];
}

/** The request being approved, as the approver needs to judge it. */
export interface ApprovalRequestInfo {
  id: number;
  ref: string;
  title: string;
  requester: string;
  organization: string;
  service: string;
  subcategory: string;
  createdAt: string;
}

export interface ApprovalSummary {
  id: number;
  status: ApprovalStatus;
  /** True while the signed-in user's answer is awaited. */
  awaitingMe: boolean;
  /** The signed-in user's own answer, once given. */
  myAnswer: { decision: ApprovalDecision; comment: string; at: string } | null;
  /** The level now running (1-based), and how many there are. */
  level: number;
  levels: number;
  startedAt: string;
  endedAt: string;
  request: ApprovalRequestInfo;
}

export interface ApprovalDetail extends ApprovalSummary {
  /** The request's description, as plain text. */
  description: string;
  steps: ApprovalLevel[];
}

export interface ApprovalList {
  items: ApprovalSummary[];
  /** How many wait for the signed-in user, whatever the list shows. */
  pending: number;
}

/** The approval on one request, for the screens that show the request. */
export interface RecordApproval {
  id: number;
  status: ApprovalStatus;
  startedAt: string;
  endedAt: string;
  steps: ApprovalLevel[];
}
