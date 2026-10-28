import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { dashboardQuerySchema, ticketQuerySchema } from "./sla.schemas.js";

/**
 * The SLA dashboard: open tickets by SLA state, and the tickets behind any
 * count. Staff only (the auth guard keeps portal users off /api/sla).
 */
export function registerSlaRoutes(app: FastifyInstance, services: Services): void {
  const { sla } = services;

  app.get("/api/sla/dashboard", async (request) => {
    const query = parse(dashboardQuerySchema, request.query, "query parameters");
    return sla.dashboard(query.type);
  });

  app.get("/api/sla/tickets", async (request) => {
    const query = parse(ticketQuerySchema, request.query, "query parameters");
    return sla.tickets(query);
  });
}
