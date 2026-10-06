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

export interface IncidentDetail extends Incident {
  description: string;
  caller?: { id: string; name: string };
  organization?: { id: string; name: string };
  team?: { id: string; name: string };
  service?: string;
  serviceSubcategory?: string;
  impact?: string;
  urgency?: string;
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
}
