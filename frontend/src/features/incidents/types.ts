// incidents: feature types.
import type { TicketPriority, TicketStatus } from '@/types/ticket';

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
}

export interface CaseLogEntry {
  date: string;
  author: string;
  message: string;
  isPrivate?: boolean;
}

export type OperationalStatus = 'operational' | 'degraded' | 'outage';

/** The lifecycle actions the backend exposes. */
export type TransitionAction = 'assign' | 'reassign' | 'hold' | 'resolve' | 'close' | 'reopen';

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
  parentIncident?: { id: string; ref: string; title: string };
  parentRequest?: { id: string; ref: string; title: string };
  parentProblem?: { id: string; ref: string; title: string };
  parentChange?: { id: string; ref: string; title: string };
  relatedRequests?: Array<{ id: string; ref: string; title: string }>;
  childIncidents?: Array<{ id: string; ref: string; title: string }>;
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
  solution?: string;
  resolutionCode?: string;
  pendingReason?: string;
  comment?: string;
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