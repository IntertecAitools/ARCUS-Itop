import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  cancelSchema,
  draftListQuery,
  draftParams,
  draftSchema,
  entryParams,
  markDuplicateSchema,
  overrideSchema,
  reportQuerySchema,
  suggestSchema,
  ticketParams,
  worklogSchema,
} from "./ticket-handling.schemas.js";
import type { DraftInput, DuplicateQuery, MarkDuplicateInput, WorklogInput } from "./ticket-handling.types.js";

/**
 * Priority override, duplicates, cancel and worklogs on incidents and user
 * requests (/api/ticket-handling, staff), and the signed-in user's drafts of
 * the new-ticket forms (/api/me/drafts, which the guard opens to staff and
 * end users alike; the service keeps each to their own forms).
 *
 * Static paths are declared before `/:class/:id`.
 */
export function registerTicketHandlingRoutes(app: FastifyInstance, services: Services): void {
  const { ticketHandling: handling, drafts } = services;

  app.get("/api/ticket-handling/worklogs/report", async (request) => {
    const q = parse(reportQuerySchema, request.query, "query parameters");
    return handling.report({
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    });
  });

  app.delete("/api/ticket-handling/worklogs/:entryId", async (request) => {
    const { entryId } = parse(entryParams, request.params, "path parameters");
    return handling.deleteTime(entryId);
  });

  /** Likely duplicates of a ticket still being written. */
  app.post("/api/ticket-handling/duplicates/suggest", async (request) => {
    const body = parse(suggestSchema, request.body, "request body");
    return { items: await handling.suggestDuplicates(body as DuplicateQuery) };
  });

  app.get("/api/ticket-handling/:class/:id", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    return handling.summary(p.class, p.id);
  });

  app.put("/api/ticket-handling/:class/:id/priority", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    const body = parse(overrideSchema, request.body, "request body");
    return handling.overridePriority(p.class, p.id, body);
  });

  app.get("/api/ticket-handling/:class/:id/duplicates/suggestions", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    return { items: await handling.suggestFor(p.class, p.id) };
  });

  app.post("/api/ticket-handling/:class/:id/duplicate", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    const body = parse(markDuplicateSchema, request.body, "request body");
    return handling.markDuplicate(p.class, p.id, body as MarkDuplicateInput);
  });

  app.post("/api/ticket-handling/:class/:id/cancel", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    const { reason } = parse(cancelSchema, request.body, "request body");
    await handling.cancel(p.class, p.id, reason);
    return handling.summary(p.class, p.id);
  });

  app.get("/api/ticket-handling/:class/:id/worklogs", async (request) => {
    const p = parse(ticketParams, request.params, "path parameters");
    return handling.worklog(p.class, p.id);
  });

  app.post("/api/ticket-handling/:class/:id/worklogs", async (request, reply) => {
    const p = parse(ticketParams, request.params, "path parameters");
    const body = parse(worklogSchema, request.body, "request body");
    reply.code(201);
    return handling.logTime(p.class, p.id, body as WorklogInput);
  });

  /* Drafts: the signed-in user's own. */

  app.get("/api/me/drafts", async (request) => {
    const { kind } = parse(draftListQuery, request.query, "query parameters");
    return { items: await drafts.list(kind) };
  });

  app.get("/api/me/drafts/:id", async (request) => {
    const { id } = parse(draftParams, request.params, "path parameters");
    return drafts.get(id);
  });

  app.post("/api/me/drafts", async (request, reply) => {
    const body = parse(draftSchema, request.body, "request body");
    const draft = await drafts.create(body as DraftInput);
    reply.code(201).header("location", `/api/me/drafts/${draft.id}`);
    return draft;
  });

  app.put("/api/me/drafts/:id", async (request) => {
    const { id } = parse(draftParams, request.params, "path parameters");
    const body = parse(draftSchema, request.body, "request body");
    return drafts.update(id, body as DraftInput);
  });

  app.delete("/api/me/drafts/:id", async (request, reply) => {
    const { id } = parse(draftParams, request.params, "path parameters");
    await drafts.remove(id);
    reply.code(204);
    return null;
  });
}
