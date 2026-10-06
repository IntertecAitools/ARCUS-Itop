/**
 * dashboard: public API.
 *
 * The ONLY file other modules (and the app shell) may import from. Everything
 * else under this folder is private to the module — that boundary is what keeps
 * modules independently buildable and independently deletable.
 */
export { registerDashboardRoutes } from "./dashboard.routes.js";
export { DashboardService } from "./dashboard.service.js";
export type {
  DashboardOverview,
  DateRange,
  NavCounts,
  TicketDto,
} from "./dashboard.service.js";
