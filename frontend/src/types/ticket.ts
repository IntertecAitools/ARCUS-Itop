/**
 * The UI's ticket vocabulary.
 *
 * These are OUR terms, not iTop's. The BFF maps iTop's internal values
 * (`assigned`, `pending`, `org_id`, OQL …) onto this vocabulary, so no iTop
 * concept ever reaches a component. If a new status appears, it is added here
 * and in the BFF mapping — never handled ad hoc in a screen.
 */

export const TICKET_STATUSES = [
  'new',
  // Sent to a team, nobody in it has taken it yet.
  'dispatched',
  'open',
  'in_progress',
  'pending',
  'resolved',
  'closed',
  // User requests only, while an approval runs or once it is decided.
  'awaiting_approval',
  'approved',
  'rejected',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** States only user requests reach; filters for incidents leave them out. */
export const REQUEST_ONLY_STATUSES: readonly TicketStatus[] = ['awaiting_approval', 'approved', 'rejected'];

export const TICKET_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export type SlaState = 'on_time' | 'at_risk' | 'breached';

export interface TicketSummary {
  id: string;
  /** Human reference shown in tables: INC-1042. */
  ref: string;
  summary: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: { id: string; name: string; avatarUrl?: string };
  createdAt: string;
  updatedAt?: string;
  slaState?: SlaState;
}

/** Why a ticket is on hold and when someone acts on it again. */
export interface PendingInfo {
  reason: string;
  /** A day, `YYYY-MM-DD`. Absent when the platform has none recorded. */
  nextActionDate?: string;
  /** The next-action date has passed and the ticket is still on hold. */
  overdue: boolean;
}
