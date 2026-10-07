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
  createdAt: string;
}

export interface IncidentListResult {
  items: Incident[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

export type IncidentSort = 'ref' | 'title' | 'status' | 'priority' | 'start_date';

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
}

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
  sla: {
    ttoBreached: boolean;
    ttrBreached: boolean;
    ttoDeadline?: string;
    ttrDeadline?: string;
  };
  resolution?: string;
  resolutionCode?: string;
  log: CaseLogEntry[];
  /**
   * Which actions are legal right now, computed by the backend from iTop's own
   * lifecycle. Render buttons from this — never guess, or the UI will offer a
   * transition iTop rejects.
   */
  availableActions: TransitionAction[];
}

/**
 * NOTE: no `priority`. iTop DERIVES priority from urgency × impact and ignores
 * an explicit value, so the form sets urgency and impact; priority comes back
 * computed.
 */
export interface CreateIncidentInput {
  title: string;
  description: string;
  organizationId: string;
  callerId?: string;
  urgency?: string;
  impact?: string;
  origin?: string;
  serviceId?: string;
  agentId?: string;
  teamId?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  urgency?: string;
  impact?: string;
  agentId?: string | null;
  teamId?: string | null;
  serviceId?: string | null;
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
}
