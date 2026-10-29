import type {
  CaseLogEntry,
  TicketDto,
  TicketPriority,
  TicketStatus,
  TransitionAction,
} from "../../shared/ticket-mapping.js";
import type { PendingInfo } from "./ticket-extras.js";

/**
 * DTOs for the incidents module.
 *
 * `frontend/src/features/incidents/types.ts` mirrors this file. That pairing is
 * the contract between the two halves — change one, change the other.
 */

export type { CaseLogEntry, PendingInfo, TicketDto, TicketPriority, TicketStatus, TransitionAction };

/**
 * A ticket row plus what the arcus-incident-extras extension adds: why and
 * until when it is on hold, and whether it is a major incident. Both are
 * absent on an iTop without the extension (the reason alone is iTop's own).
 */
export interface IncidentRow extends TicketDto {
  /** Only while the incident is on hold. */
  pending?: PendingInfo;
  major?: boolean;
}

/** An incident linked to another: a major incident's children, or its parent. */
export interface LinkedIncident {
  id: string;
  ref: string;
  summary: string;
  status: TicketStatus;
}

export interface IncidentListQuery {
  page: number;
  limit: number;
  /** Free text across ref and title. */
  q?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  /** `unassigned`, or a numeric agent id. */
  assignee?: string;
  sort?: "ref" | "title" | "status" | "priority" | "start_date";
  order?: "asc" | "desc";
  /** Major incidents only. */
  major?: boolean;
  /** On hold and past their next-action date. */
  overdue?: boolean;
}

export interface IncidentListResult {
  items: IncidentRow[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

export interface IncidentDetail extends IncidentRow {
  description: string;
  caller?: { id: string; name: string };
  organization?: { id: string; name: string };
  team?: { id: string; name: string };
  service?: string;
  serviceSubcategory?: string;
  impact?: string;
  urgency?: string;
  origin?: string;
  resolvedAt?: string;
  closedAt?: string;
  lastUpdatedAt?: string;
  sla: {
    ttoBreached: boolean;
    ttrBreached: boolean;
    ttoDeadline?: string;
    ttrDeadline?: string;
  };
  resolution?: string;
  resolutionCode?: string;
  /** Public conversation, newest last. */
  log: CaseLogEntry[];
  /**
   * Which actions are legal right now, derived from iTop's own lifecycle.
   * The UI renders buttons from this rather than guessing, so it can never
   * offer a transition iTop would reject.
   */
  availableActions: TransitionAction[];
  /** The major incident this one is linked to. */
  parentIncident?: LinkedIncident;
  /** Incidents linked to this one (a major incident's children). */
  childIncidents: LinkedIncident[];
  /**
   * Whether this iTop has the arcus-incident-extras fields; without them
   * the major flag and the next-action date cannot be set.
   */
  extrasAvailable: boolean;
}

/**
 * NOTE: there is no `priority`. iTop DERIVES priority from urgency x impact,
 * and silently ignores an explicit value — accepting one here would be an API
 * that appears to work and doesn't. Set urgency and impact instead; priority
 * comes back computed.
 */
export interface CreateIncidentInput {
  title: string;
  description: string;
  /** Optional: the server resolves the default organisation when omitted. */
  organizationId?: string;
  callerId?: string;
  urgency?: string;
  impact?: string;
  origin?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
  agentId?: string;
  teamId?: string;
  /** When the fault actually began, if earlier than now. */
  startDate?: string;
}

/** Same rule as create: priority is derived, so it is not writable. */
export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  urgency?: string;
  impact?: string;
  agentId?: string | null;
  teamId?: string | null;
  serviceId?: string | null;
  serviceSubcategoryId?: string | null;
}

export interface TransitionInput {
  action: TransitionAction;
  agentId?: string;
  /** `dispatch` only, required: the team it goes to. */
  teamId?: string;
  solution?: string;
  resolutionCode?: string;
  /** `hold` only, required: why it waits. */
  pendingReason?: string;
  /** `hold` only, required: the day (YYYY-MM-DD) to act again. */
  nextActionDate?: string;
  /** Appended to the public log alongside the transition. */
  comment?: string;
}

/** Everything a create/edit form needs to render its pickers. */
export interface IncidentOptions {
  priorities: Array<{ value: string; label: string }>;
  urgencies: Array<{ value: string; label: string }>;
  impacts: Array<{ value: string; label: string }>;
  origins: Array<{ value: string; label: string }>;
  resolutionCodes: Array<{ value: string; label: string }>;
  organizations: Array<{ value: string; label: string }>;
  agents: Array<{ value: string; label: string }>;
  teams: Array<{ value: string; label: string }>;
  services: Array<{ value: string; label: string }>;
  /** Each carries its parent service, so the picker can narrow on selection. */
  serviceSubcategories: Array<{ value: string; label: string; serviceId: string }>;
}

/** A stakeholder update on a major incident. */
export interface StakeholderUpdateInput {
  message: string;
  /** Also post it on every linked (child) incident's public log. */
  postToChildren?: boolean;
  /** Email it to the callers of the major incident and its children. */
  notifyCallers?: boolean;
  /** Further addresses to email it to. */
  notifyEmails?: string[];
}

export interface StakeholderUpdateResult {
  incident: IncidentDetail;
  /** Child incidents the update was posted on. */
  postedTo: number;
  /** Addresses it was emailed to. */
  notified: string[];
  /** Set when an email could not be sent; the log entries were still made. */
  notifyError?: string;
}
