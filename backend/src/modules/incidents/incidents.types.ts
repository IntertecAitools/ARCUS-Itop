import type { TicketDto, TicketPriority, TicketStatus } from "../../shared/ticket-mapping.js";

/**
 * DTOs for the incidents module.
 *
 * `frontend/src/features/incidents/types.ts` mirrors this file. That pairing is
 * the contract between the two halves — change one, change the other.
 */

export type { TicketDto, TicketPriority, TicketStatus };

export interface IncidentListQuery {
  page: number;
  limit: number;
  /** Free text across ref and title. */
  q?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  /** `me` resolves to the caller; an id filters to that agent. */
  assignee?: string;
  sort?: "ref" | "title" | "status" | "priority" | "start_date";
  order?: "asc" | "desc";
}

export interface IncidentListResult {
  items: TicketDto[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

/** The detail screen needs more than a row does. */
export interface IncidentDetail extends TicketDto {
  description: string;
  /** Who reported it. */
  caller?: { id: string; name: string };
  organization?: { id: string; name: string };
  team?: { id: string; name: string };
  service?: string;
  serviceSubcategory?: string;
  impact?: string;
  urgency?: string;
  /** ISO datetimes, absent while the incident is still open. */
  resolvedAt?: string;
  closedAt?: string;
  lastUpdatedAt?: string;
  sla: {
    /** True once iTop flags the time-to-own / time-to-resolve target as passed. */
    ttoBreached: boolean;
    ttrBreached: boolean;
    ttoDeadline?: string;
    ttrDeadline?: string;
  };
  resolution?: string;
}
