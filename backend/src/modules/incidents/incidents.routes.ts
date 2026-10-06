import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { incidentIdParamSchema, incidentListQuerySchema } from "./incidents.schemas.js";

/**
 * HTTP surface for incidents.
 *
 * Routes validate and map to status codes; they make no decisions. Anything
 * resembling a business rule belongs in IncidentsService.
 */
export function registerIncidentRoutes(app: FastifyInstance, services: Services): void {
  const { incidents } = services;

  app.get("/api/incidents", async (request) => {
    const query = parse(incidentListQuerySchema, request.query, "query parameters");
    return incidents.list(query);
  });

  app.get("/api/incidents/:id", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    // A missing incident throws notFound, which the app's error handler turns
    // into a 404 — no status juggling here.
    return incidents.get(id);
  });
}
