import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

const overviewQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d", "90d"]).default("7d"),
});

/**
 * Screen-shaped endpoints.
 *
 * Unlike /api/objects/* these are not generic: they exist so one screen costs
 * one request. Each is owned by the feature that renders it.
 */
export function registerDashboardRoutes(app: FastifyInstance, services: Services): void {
  const { dashboard } = services;

  app.get("/api/dashboard/overview", async (request) => {
    const query = parse(overviewQuerySchema, request.query, "query parameters");
    return dashboard.overview(query.range);
  });

  /** Sidebar badge counts — one call for the whole shell, not one per module. */
  app.get("/api/nav/counts", async () => dashboard.navCounts());
}
