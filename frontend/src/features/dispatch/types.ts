import type { TicketPriority } from '@/types/ticket';

/** Mirrors backend/src/modules/dispatch/dispatch.types.ts. */

/** Incidents and (service) requests. */
export type TicketType = 'incident' | 'request';

/**
 * One assignment rule: a new ticket matching every criterion set here goes
 * to `teamId`. Unset criteria match anything; the first matching rule wins.
 */
export interface AssignmentRule {
  id: string;
  name: string;
  enabled: boolean;
  /** The ticket's category. */
  ticketType?: TicketType;
  organizationId?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
  teamId: string;
}

export interface AssignmentRules {
  rules: AssignmentRule[];
  /** Email the team when a ticket is dispatched to it. */
  notifyTeam: boolean;
}

export interface AssignmentRulesDto extends AssignmentRules {
  /** False when the platform cannot dispatch to a team yet. */
  available: boolean;
  mailConfigured: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface RoutingFacts {
  ticketType: TicketType;
  organizationId?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
}

export interface RuleTestResult {
  rule?: AssignmentRule;
}

export interface TeamQueueItem {
  type: TicketType;
  id: string;
  ref: string;
  summary: string;
  priority: TicketPriority;
  team: { id: string; name: string };
  organization?: string;
  service?: string;
  createdAt: string;
  dispatchedAt?: string;
  ttoDeadline?: string;
  escalated: boolean;
}

export interface TeamQueue {
  teams: Array<{ id: string; name: string }>;
  items: TeamQueueItem[];
  available: boolean;
  truncated: boolean;
}

export interface TakenTicket {
  type: TicketType;
  id: string;
  ref: string;
}
