import type { TicketPriority } from "../../shared/ticket-mapping.js";

/** The two kinds of ticket a team picks up: iTop's Incident and UserRequest. */
export type TicketType = "incident" | "request";

/**
 * One assignment rule: a new ticket that matches every criterion set here
 * is dispatched to `teamId`. Unset criteria match anything, so a rule with
 * none is a catch-all. Rules are tried in list order; the first match wins.
 */
export interface AssignmentRule {
  id: string;
  name: string;
  enabled: boolean;
  /** The ticket's category: incident or service request. */
  ticketType?: TicketType;
  organizationId?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
  teamId: string;
}

export interface AssignmentRules {
  /** In the order they are tried. */
  rules: AssignmentRule[];
  /** Email the team when a ticket is dispatched to it, by a rule or by hand. */
  notifyTeam: boolean;
}

export interface AssignmentRulesDto extends AssignmentRules {
  /** False when iTop lacks the arcus-ticket-dispatch extension: rules route nothing. */
  available: boolean;
  /** False when no mail server is configured, so `notifyTeam` sends nothing. */
  mailConfigured: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** What a rule is matched against. */
export interface RoutingFacts {
  ticketType: TicketType;
  organizationId?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
}

export interface RuleTestResult {
  /** The rule that would route the ticket; absent when it would stay New. */
  rule?: AssignmentRule;
}

/** A ticket waiting in a team's queue: dispatched, nobody has taken it. */
export interface TeamQueueItem {
  type: TicketType;
  id: string;
  ref: string;
  summary: string;
  priority: TicketPriority;
  team: { id: string; name: string };
  organization?: string;
  service?: string;
  /** ISO instants. */
  createdAt: string;
  dispatchedAt?: string;
  /** When TTO runs out; absent when no SLA applies. */
  ttoDeadline?: string;
  /** TTO ran out while it waited (iTop escalated it). */
  escalated: boolean;
}

export interface TeamQueue {
  /** The teams the signed-in person belongs to. */
  teams: Array<{ id: string; name: string }>;
  /** Oldest dispatch first. */
  items: TeamQueueItem[];
  /** False when iTop lacks the arcus-ticket-dispatch extension. */
  available: boolean;
  /** More tickets wait than were read. */
  truncated: boolean;
}

/** A ticket after "Take it": now assigned to the caller. */
export interface TakenTicket {
  type: TicketType;
  id: string;
  ref: string;
}
