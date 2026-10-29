// incidents: feature types.
import type { PendingInfo, TicketPriority, TicketStatus } from '@/types/ticket';

export type { PendingInfo };

/**
 * Mirrors `backend/src/modules/incidents/incidents.types.ts`. That pairing is
 * the contract between the two halves — change one, change the other.
 */

export interface Incident {
  id: string;
  ref: string;
  summary: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: { id: string; name: string };
  caller?: { id: string; name: string };
  organization?: { id: string; name: string };
  createdAt: string;
  operationalStatus?: string;
  /** Only while on hold: why, and the day to act again. */
  pending?: PendingInfo;
  /** A major incident. Absent when the platform cannot record it. */
  major?: boolean;
}

/** An incident linked to another: a major incident's child, or its parent. */
export interface LinkedIncident {
  id: string;
  ref: string;
  summary: string;
  status: TicketStatus;
}

export interface IncidentListResult {
  items: Incident[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

export type IncidentSort = 'ref' | 'title' | 'status' | 'priority' | 'start_date' | 'caller_id' | 'org_id';

export interface IncidentFilters {
  page: number;
  q?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  /** A numeric agent id, or `unassigned`. */
  assignee?: string;
  sort?: IncidentSort;
  order?: 'asc' | 'desc';
  /** Major incidents only. */
  major?: boolean;
  /** On hold and past the next-action date. */
  overdue?: boolean;
}

export interface CaseLogEntry {
  date: string;
  author: string;
  message: string;
  isPrivate?: boolean;
}

export type OperationalStatus = 'operational' | 'degraded' | 'outage';

/** The lifecycle actions the backend exposes. */
export type TransitionAction = 'assign' | 'dispatch' | 'reassign' | 'hold' | 'resolve' | 'close' | 'reopen';

export interface IncidentDetail extends Incident {
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
  assignmentDate?: string;
  lastPendingDate?: string;
  ttoDeadline?: string;
  ttrDeadline?: string;
  sla: {
    ttoBreached: boolean;
    ttrBreached: boolean;
    ttoDeadline?: string;
    ttrDeadline?: string;
    ttoPassed?: boolean;
    ttoOver?: boolean;
    ttrPassed?: boolean;
    ttrOver?: boolean;
  };
  escalationFlag?: string;
  escalationReason?: string;
  pendingReason?: string;
  operationalStatus?: OperationalStatus;
  resolution?: string;
  resolutionCode?: string;
  timeSpent?: string;
  userSatisfaction?: string;
  userComment?: string;
  log: CaseLogEntry[];
  privateLog?: CaseLogEntry[];
  /** The major incident this one is linked to. */
  parentIncident?: LinkedIncident;
  parentRequest?: { id: string; ref: string; title: string };
  parentProblem?: { id: string; ref: string; title: string };
  parentChange?: { id: string; ref: string; title: string };
  relatedRequests?: Array<{ id: string; ref: string; title: string }>;
  /** Incidents linked to this one (a major incident's children). */
  childIncidents?: LinkedIncident[];
  /** Whether the next-action date and the major flag can be recorded. */
  extrasAvailable?: boolean;
  escalationFlagDisplay?: string;
  escalationReasonDisplay?: string;
  pendingReasonDisplay?: string;
  availableActions: TransitionAction[];
}

export interface OperationalStatusOption {
  value: OperationalStatus;
  label: string;
}

/**
 * NOTE: no `priority`. iTop DERIVES priority from urgency × impact and ignores
 * an explicit value, so the form sets urgency and impact; priority comes back
 * computed.
 */
export interface CreateIncidentInput {
  title: string;
  description: string;
  /** Optional: the BFF resolves the default organisation when omitted. */
  organizationId?: string;
  callerId?: string;
  urgency?: string;
  impact?: string;
  origin?: string;
  serviceId?: string;
  serviceSubcategoryId?: string;
  agentId?: string;
  teamId?: string;
  startDate?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  urgency?: string;
  impact?: string;
  agentId?: string | null;
  teamId?: string | null;
  serviceId?: string | null;
  serviceSubcategoryId?: string | null;
  operationalStatus?: OperationalStatus | null;
  escalationFlag?: string | null;
  escalationReason?: string | null;
  pendingReason?: string | null;
}

export interface TransitionInput {
  action: TransitionAction;
  agentId?: string;
  /** `dispatch` only: the team it goes to. */
  teamId?: string;
  solution?: string;
  resolutionCode?: string;
  pendingReason?: string;
  /** `hold` only: the day (YYYY-MM-DD) to act again. */
  nextActionDate?: string;
  comment?: string;
}

/** A stakeholder update on a major incident. */
export interface StakeholderUpdateInput {
  message: string;
  /** Also post it on every open linked incident. */
  postToChildren?: boolean;
  /** Email it to the callers of the incident and its linked incidents. */
  notifyCallers?: boolean;
  notifyEmails?: string[];
}

export interface StakeholderUpdateResult {
  incident: IncidentDetail;
  postedTo: number;
  notified: string[];
  notifyError?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface OperationalStatusSelectOption extends SelectOption {
  value: OperationalStatus;
}

/** A person, as the caller picker needs them. */
export interface PersonOption {
  id: string;
  fullName: string;
  email?: string;
}

export interface RelatedObjectOption {
  id: string;
  ref: string;
  title: string;
}

export interface IncidentOptions {
  priorities: SelectOption[];
  urgencies: SelectOption[];
  impacts: SelectOption[];
  origins: SelectOption[];
  resolutionCodes: SelectOption[];
  organizations: SelectOption[];
  agents: SelectOption[];
  teams: SelectOption[];
  services: SelectOption[];
  operationalStatuses: OperationalStatusSelectOption[];
  /** Each carries its parent service, so the picker narrows on selection. */
  serviceSubcategories: Array<SelectOption & { serviceId: string }>;
}