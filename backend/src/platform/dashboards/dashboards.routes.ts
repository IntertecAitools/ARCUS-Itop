import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

/**
 * Dashboard endpoints.
 *
 * The structure endpoint carries no OQL; the data endpoint runs one dashlet's
 * query server-side and returns only the computed result. The frontend never
 * holds an iTop query -- same boundary the navigation views keep.
 */

// Dashboard ids are menu ids, e.g. "Incident:Overview" -- colons, not plain
// identifiers.
const idSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9_:-]+$/, "a dashboard id may only contain letters, digits, _, - and :");

export function registerDashboardRoutes(app: FastifyInstance, services: Services): void {
  const { dashboards } = services;

  /** Which dashboards exist, with their titles. */
  app.get("/api/meta/dashboards", async () => ({
    dashboards: dashboards.ids.map((id) => ({ id, title: dashboards.public(id).title })),
  }));

  /** One dashboard's layout and dashlets, without any OQL. */
  app.get("/api/meta/dashboards/:id", async (request) => {
    const { id } = parse(z.object({ id: idSchema }), request.params, "path parameters");
    return dashboards.public(id);
  });

  /** The computed data for a single dashlet. The query runs here. */
  app.get("/api/dashboards/:id/dashlets/:dashletId", async (request) => {
    const params = parse(
      z.object({ id: idSchema, dashletId: z.string().max(40).regex(/^[A-Za-z0-9_-]+$/) }),
      request.params,
      "path parameters",
    );
    return dashboards.compute(params.id, params.dashletId);
  });
}
