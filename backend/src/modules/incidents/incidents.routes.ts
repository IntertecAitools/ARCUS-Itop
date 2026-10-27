import type { FastifyInstance } from "fastify";

import { notFound } from "../../core/errors.js";
import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  childParamSchema,
  createIncidentSchema,
  incidentIdParamSchema,
  incidentListQuerySchema,
  linkChildrenSchema,
  logEntrySchema,
  majorSchema,
  stakeholderUpdateSchema,
  ticketParamSchema,
  transitionSchema,
  updateIncidentSchema,
} from "./incidents.schemas.js";
import type {
  CreateIncidentInput,
  StakeholderUpdateInput,
  TransitionInput,
  UpdateIncidentInput,
} from "./incidents.types.js";

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

  /** Open major incidents, for the dashboard banner. Static, so before `/:id`. */
  app.get("/api/incidents/major", async () => ({ items: await incidents.openMajor() }));

  app.get("/api/incidents", async (request) => {
    const query = parse(incidentListQuerySchema, request.query, "query parameters");
    if (query.assignee === "me") {
      // 400s when the account has no linked Person: "assigned to me" has no
      // answer then, and 0 would mean "unassigned".
      query.assignee = await services.currentContact.resolve();
    }
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

  /* Major incidents: the flag, the linked children, stakeholder updates. */

  app.put("/api/incidents/:id/major", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const { major } = parse(majorSchema, request.body, "request body");
    return incidents.setMajor(id, major);
  });

  app.post("/api/incidents/:id/children", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const { incidentIds } = parse(linkChildrenSchema, request.body, "request body");
    return incidents.linkChildren(id, incidentIds);
  });

  app.delete("/api/incidents/:id/children/:childId", async (request) => {
    const { id, childId } = parse(childParamSchema, request.params, "path parameters");
    return incidents.unlinkChild(id, childId);
  });

  app.post("/api/incidents/:id/stakeholder-updates", async (request) => {
    const { id } = parse(incidentIdParamSchema, request.params, "path parameters");
    const body = parse(stakeholderUpdateSchema, request.body, "request body");
    return incidents.postStakeholderUpdate(id, body as StakeholderUpdateInput);
  });

  /**
   * Why and until when a ticket (incident or user request) is on hold, for
   * the generic record screen, which reads no extension fields. Putting a
   * user request on hold goes through the generic stimulus route
   * (`ev_pending`), which hands it to the same TicketExtras.
   */
  app.get("/api/tickets/:class/:id/pending", async (request) => {
    const params = parse(ticketParamSchema, request.params, "path parameters");
    const rows = await services.ticketExtras.read(params.class, [params.id]);
    const row = rows.get(params.id);
    if (!row) throw notFound(`${params.class} ${params.id} was not found.`);
    return {
      pending: row.pending ?? null,
      extrasAvailable: await services.ticketExtras.available(params.class),
    };
  });
}
