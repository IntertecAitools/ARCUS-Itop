import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  createIncidentSchema,
  incidentIdParamSchema,
  incidentListQuerySchema,
  logEntrySchema,
  transitionSchema,
  updateIncidentSchema,
} from "./incidents.schemas.js";
import type { CreateIncidentInput, TransitionInput, UpdateIncidentInput } from "./incidents.types.js";

/**
 * HTTP surface for incidents.
 *
 * Routes validate and map to status codes; they make no decisions. Anything
 * resembling a business rule belongs in IncidentsService.
 */
export function registerIncidentRoutes(app: FastifyInstance, services: Services): void {
  const { incidents } = services;

  /**
   * Static path, declared before `/:id` — otherwise "options" would be parsed
   * as an incident id and rejected as non-numeric.
   */
  app.get("/api/incidents/options", async () => incidents.formOptions());

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

  app.post("/api/incidents", async (request, reply) => {
    const body = parse(createIncidentSchema, request.body, "request body");
    const created = await incidents.create(body as CreateIncidentInput);
    // 201 with a Location header, so a client can follow the new resource.
    reply.code(201).header("location", `/api/incidents/${created.id}`);
    return created;
  });

  app.patch("/api/incidents/:id", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const body = parse(updateIncidentSchema, request.body, "request body");
    return incidents.update(id, body as UpdateIncidentInput);
  });

  /** Lifecycle actions: assign, reassign, hold, resolve, close, reopen. */
  app.post("/api/incidents/:id/transitions", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const body = parse(transitionSchema, request.body, "request body");
    return incidents.transition(id, body as TransitionInput);
  });

  app.post("/api/incidents/:id/log", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const { message } = parse(logEntrySchema, request.body, "request body");
    return incidents.addLogEntry(id, message);
  });
}
