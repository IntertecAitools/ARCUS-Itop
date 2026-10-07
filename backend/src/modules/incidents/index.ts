/**
 * incidents: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerIncidentRoutes } from "./incidents.routes.js";
export { IncidentsService } from "./incidents.service.js";
export type {
  CaseLogEntry,
  CreateIncidentInput,
  IncidentDetail,
  IncidentListQuery,
  IncidentListResult,
  IncidentOptions,
  TicketDto,
  TicketPriority,
  TicketStatus,
  TransitionAction,
  TransitionInput,
  UpdateIncidentInput,
} from "./incidents.types.js";
