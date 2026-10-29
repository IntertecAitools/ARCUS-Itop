import type { TicketPriority, TicketStatus } from '@/types/ticket';

/**
 * Mirrors backend/src/modules/ticket-handling/ticket-handling.types.ts.
 * The two files describe the same JSON.
 */

export type HandledClass = 'Incident' | 'UserRequest';

export interface TicketRef {
  class: HandledClass;
  id: number;
  ref: string;
  title: string;
  status: TicketStatus;
}

export interface PriorityOverride {
  from: TicketPriority;
  to: TicketPriority;
  reason: string;
  by: string;
  at: string;
  impactFrom: string;
  urgencyFrom: string;
  impactTo: string;
  urgencyTo: string;
  /** False once someone reassessed impact or urgency. */
  active: boolean;
}

export interface CancelInfo {
  reason: string;
  by: string;
}

export interface TicketHandling {
  class: HandledClass;
  id: number;
  ref: string;
  open: boolean;
  priority: TicketPriority;
  override?: PriorityOverride;
  duplicateOf?: TicketRef;
  duplicates: TicketRef[];
  cancelled?: CancelInfo;
  can: { overridePriority: boolean; markDuplicate: boolean; cancel: boolean; logTime: boolean };
  worklog: { totalMinutes: number; entries: number };
}

export interface WorklogEntry {
  id: number;
  class: HandledClass;
  ticketId: number;
  ticketRef: string;
  agent: { userId: number; contactId: number; name: string };
  minutes: number;
  note: string;
  workDate: string;
  createdAt: string;
  mine?: boolean;
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

export interface WorklogInput {
  minutes: number;
  note: string;
  workDate?: string;
}

export interface WorklogReport {
  from: string;
  to: string;
  totalMinutes: number;
  byAgent: AgentTotal[];
  byTicket: { class: HandledClass; ticketId: number; ticketRef: string; minutes: number; entries: number }[];
}

export interface DuplicateQuery {
  class: HandledClass;
  title: string;
  orgId?: number;
  callerId?: number;
  serviceId?: number;
  ciIds?: number[];
  excludeId?: number;
}

export interface DuplicateCandidate extends TicketRef {
  caller: string;
  createdAt: string;
  score: number;
  reasons: string[];
}

export type DraftKind = 'incident' | 'user-request' | 'portal-request';

export interface Draft {
  id: string;
  kind: DraftKind;
  title: string;
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
