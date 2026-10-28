/**
 * sla: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerSlaRoutes } from "./sla.routes.js";
export { SlaService } from "./sla.service.js";
export type {
  SlaCounts,
  SlaDashboard,
  SlaGroup,
  SlaMetric,
  SlaMetricState,
  SlaState,
  SlaTicket,
  SlaTicketList,
  SlaTicketQuery,
  SlaTicketType,
} from "./sla.types.js";
