/**
 * incidents: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerIncidentRoutes } from "./incidents.routes.js";
export { IncidentsService } from "./incidents.service.js";
export type {
  IncidentDetail,
  IncidentListQuery,
  IncidentListResult,
  TicketDto,
  TicketPriority,
  TicketStatus,
} from "./incidents.types.js";
