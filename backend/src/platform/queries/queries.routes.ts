import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { identifierParam, idParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { criteriaSchema } from "../objects/criteria.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../objects/objects.service.js";
import { EXPORT_FORMATS } from "../transfer/transfer.service.js";
import type { QueryInput } from "./queries.service.js";

const queryInput = z.object({
  name: z.string().max(255),
  description: z.string().max(4_000).optional(),
  recordType: identifierParam.optional(),
  conditions: criteriaSchema.optional(),
  /** Administrators only; the service refuses it from anyone else. */
  oql: z.string().max(10_000).optional(),
  columns: z.array(identifierParam).max(50).optional(),
});

const pageQuery = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  fields: z.string().max(2_000).optional(),
  sort: identifierParam.optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

function runOptions(query: z.infer<typeof pageQuery>) {
  return {
    page: query.page,
    limit: query.limit,
    ...(query.fields !== undefined ? { fields: query.fields } : {}),
    ...(query.sort !== undefined ? { sort: query.sort } : {}),
    ...(query.order !== undefined ? { order: query.order } : {}),
  };
}

/**
 * Saved queries (iTop's query phrasebook) and running them. Open to staff;
 * the service decides who may write what, and runs every query as the caller.
 */
export function registerQueryRoutes(app: FastifyInstance, services: Services): void {
  const { queries } = services;

  app.get("/api/queries", async () => ({ queries: await queries.list() }));

  app.get("/api/queries/options", async () => queries.options());

  app.get("/api/queries/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    return queries.get(id);
  });

  app.post("/api/queries", async (request, reply) => {
    const body = parse(queryInput, request.body, "request body") as QueryInput;
    const saved = await queries.create(body);
    reply.code(201);
    return saved;
  });

  app.put("/api/queries/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const body = parse(queryInput, request.body, "request body") as QueryInput;
    return queries.update(id, body);
  });

  app.delete("/api/queries/:id", async (request, reply) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    await queries.remove(id);
    reply.code(204);
    return null;
  });

  /** A page of a saved query's records, in the records list shape. */
  app.get("/api/queries/:id/results", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const query = parse(pageQuery, request.query, "query parameters");
    return queries.run(id, runOptions(query));
  });

  /** Runs a query without saving it: `{ query, page?, limit?, fields? }`. */
  app.post("/api/queries/run", async (request) => {
    const body = parse(
      z.object({ query: queryInput.extend({ name: z.string().max(255).default("") }) }).merge(pageQuery),
      request.body,
      "request body",
    );
    return queries.runDraft(body.query as QueryInput, runOptions(body));
  });

  /** A saved query's records as CSV, Excel or PDF, as on a records list. */
  app.get("/api/queries/:id/export", async (request, reply) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const query = parse(
      z.object({ format: z.enum(EXPORT_FORMATS), fields: z.string().max(2_000).optional() }),
      request.query,
      "query parameters",
    );
    const file = await queries.export(id, query.format, query.fields);
    return reply
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(Readable.fromWeb(file.body as unknown as NodeReadableStream));
  });
}
