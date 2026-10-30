import type { TicketPriority, TicketStatus } from "../../shared/ticket-mapping.js";

/** The ticket classes these features apply to. */
export type HandledClass = "Incident" | "UserRequest";

export interface TicketRef {
  class: HandledClass;
  id: number;
  ref: string;
  title: string;
  status: TicketStatus;
}

/** One override, as kept by the BFF (the reason is also in the private log). */
export interface PriorityOverride {
  from: TicketPriority;
  to: TicketPriority;
  reason: string;
  by: string;
  at: string;
  /** Impact and urgency before, and as set to make iTop compute `to`. */
  impactFrom: string;
  urgencyFrom: string;
  impactTo: string;
  urgencyTo: string;
  /**
   * Still in force: the ticket's impact and urgency are still the ones the
   * override set. False once someone reassessed them.
   */
  active: boolean;
}

export interface PriorityOverrideInput {
  priority: TicketPriority;
  reason: string;
}

export interface CancelInfo {
  reason: string;
  by: string;
}

export interface WorklogEntry {
  id: number;
  class: HandledClass;
  ticketId: number;
  ticketRef: string;
  agent: { userId: number; contactId: number; name: string };
  minutes: number;
  note: string;
  /** `YYYY-MM-DD`, the day the work was done. */
  workDate: string;
  createdAt: string;
  /** The signed-in user may delete it (their own, or an administrator). */
  mine?: boolean;
}

export interface WorklogInput {
  minutes: number;
  note: string;
  workDate?: string;
}

export interface AgentTotal {
  userId: number;
  name: string;
  minutes: number;
  entries: number;
}

export interface TicketWorklog {
  entries: WorklogEntry[];
  totalMinutes: number;
  byAgent: AgentTotal[];
}

export interface WorklogReportQuery {
  from?: string;
  to?: string;
  userId?: number;
}

export interface WorklogReport {
  from: string;
  to: string;
  totalMinutes: number;
  byAgent: AgentTotal[];
  byTicket: { class: HandledClass; ticketId: number; ticketRef: string; minutes: number; entries: number }[];
}

/** Everything the ticket screen shows about these features, in one read. */
export interface TicketHandling {
  class: HandledClass;
  id: number;
  ref: string;
  open: boolean;
  priority: TicketPriority;
  override?: PriorityOverride;
  /** Set when this ticket was resolved as a duplicate. */
  duplicateOf?: TicketRef;
  /** Tickets resolved as duplicates of this one. */
  duplicates: TicketRef[];
  /** Set when this ticket was cancelled. */
  cancelled?: CancelInfo;
  /** What the signed-in user may do here. */
  can: { overridePriority: boolean; markDuplicate: boolean; cancel: boolean; logTime: boolean };
  worklog: { totalMinutes: number; entries: number };
}

export interface DuplicateQuery {
  class: HandledClass;
  title: string;
  orgId?: number;
  callerId?: number;
  serviceId?: number;
  ciIds?: number[];
  /** The ticket being triaged, left out of its own suggestions. */
  excludeId?: number;
}

export interface DuplicateCandidate extends TicketRef {
  caller: string;
  createdAt: string;
  /** 0..1, higher is likelier. */
  score: number;
  /** Why it was suggested: "same caller", "same CI", "similar title", … */
  reasons: string[];
}

export interface MarkDuplicateInput {
  originalClass: HandledClass;
  originalId: number;
  note?: string;
}

/* Drafts */

export type DraftKind = "incident" | "user-request" | "portal-request";

export interface Draft {
  id: string;
  kind: DraftKind;
  title: string;
  /** The form's values, as the form keeps them. */
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSummary {
  id: string;
  kind: DraftKind;
  title: string;
  updatedAt: string;
}

export interface DraftInput {
  kind: DraftKind;
  title?: string;
  data: Record<string, unknown>;
}
