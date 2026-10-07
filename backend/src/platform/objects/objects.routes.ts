import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  boolParam,
  identifierParam,
  idParam,
  intParam,
  parse,
} from "../../core/validate.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./objects.service.js";
import type { Services } from "../../services.js";

/** Query keys the list endpoint interprets itself; anything else is a filter. */
const RESERVED_QUERY_KEYS = new Set([
  "page",
  "limit",
  "q",
  "sort",
  "order",
  "fields",
  "oql",
  "strict",
  "comment",
  "simulate",
]);

const listQuerySchema = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  q: z.string().max(200).optional(),
  sort: identifierParam.optional(),
  order: z.enum(["asc", "desc"]).optional(),
  fields: z.string().max(2_000).optional(),
  oql: z.string().max(4_000).optional(),
});

const writeBodySchema = z.object({
  fields: z.record(z.unknown()),
  comment: z.string().max(500).optional(),
  /** When false, unwritable attributes are dropped instead of rejected. */
  strict: z.boolean().optional(),
  /** Attributes to return on the created/updated object. */
  returnFields: z.string().max(2_000).optional(),
});

export function registerObjectRoutes(app: FastifyInstance, services: Services): void {
  const { objects } = services;

  /** Extracts unreserved query params as exact-match filters. */
  const extractFilters = (query: unknown): Record<string, string> => {
    const filters: Record<string, string> = {};
    if (typeof query !== "object" || query === null) return filters;
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (RESERVED_QUERY_KEYS.has(key)) continue;
      // Repeated params arrive as arrays; only the first is meaningful for an
      // equality filter, and silently ORing them would be surprising.
      const single = Array.isArray(value) ? value[0] : value;
      if (typeof single === "string" || typeof single === "number") {
        filters[key] = String(single);
      }
    }
    return filters;
  };

  app.get("/api/objects/:class", async (request) => {
    const { class: className } = parse(
      z.object({ class: identifierParam }),
      request.params,
      "path parameters",
    );
    const query = parse(listQuerySchema, request.query, "query parameters");
    const filters = extractFilters(request.query);

    return objects.list(className, {
      page: query.page,
      limit: query.limit,
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
      ...(query.order !== undefined ? { order: query.order } : {}),
      ...(query.fields !== undefined ? { fields: query.fields } : {}),
      ...(query.oql !== undefined ? { oql: query.oql } : {}),
      filters,
    });
  });

  app.get("/api/objects/:class/:id", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    const query = parse(
      z.object({ fields: z.string().max(2_000).optional() }),
      request.query,
      "query parameters",
    );
    return objects.get(params.class, params.id, query.fields);
  });

  app.post("/api/objects/:class", async (request, reply) => {
    const params = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const body = parse(writeBodySchema, request.body, "request body");

    const created = await objects.create(params.class, body.fields, {
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
      ...(body.returnFields !== undefined ? { fields: body.returnFields } : {}),
      ...(body.strict !== undefined ? { strict: body.strict } : {}),
    });

    reply.code(201);
    return created;
  });

  app.patch("/api/objects/:class/:id", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    const body = parse(writeBodySchema, request.body, "request body");

    return objects.update(params.class, params.id, body.fields, {
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
      ...(body.returnFields !== undefined ? { fields: body.returnFields } : {}),
      ...(body.strict !== undefined ? { strict: body.strict } : {}),
    });
  });

  /**
   * Deleting in iTop can cascade. ?simulate=true returns the plan without
   * touching anything, and is the only safe way to find out in advance.
   */
  app.delete("/api/objects/:class/:id", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    const query = parse(
      z.object({ simulate: boolParam(false), comment: z.string().max(500).optional() }),
      request.query,
      "query parameters",
    );

    return objects.remove(params.class, params.id, {
      simulate: query.simulate,
      ...(query.comment !== undefined ? { comment: query.comment } : {}),
    });
  });

  app.post("/api/objects/:class/:id/stimulus", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    const body = parse(
      z.object({
        stimulus: identifierParam,
        fields: z.record(z.unknown()).optional(),
        comment: z.string().max(500).optional(),
        returnFields: z.string().max(2_000).optional(),
      }),
      request.body,
      "request body",
    );

    return objects.applyStimulus(params.class, params.id, body.stimulus, body.fields, {
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
      ...(body.returnFields !== undefined ? { fields: body.returnFields } : {}),
    });
  });

  /** Objects on the far side of a LinkedSet / LinkedSetIndirect attribute. */
  app.get("/api/objects/:class/:id/links/:attcode", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam, attcode: identifierParam }),
      request.params,
      "path parameters",
    );
    const query = parse(
      z.object({
        page: intParam(1, 100_000, 1),
        limit: intParam(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
        fields: z.string().max(2_000).optional(),
      }),
      request.query,
      "query parameters",
    );

    return objects.links(params.class, params.id, params.attcode, {
      page: query.page,
      limit: query.limit,
      ...(query.fields !== undefined ? { fields: query.fields } : {}),
    });
  });

  /** Impact-analysis graph for a CI. */
  app.get("/api/objects/:class/:id/related", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    const query = parse(
      z.object({
        relation: z.string().max(60).optional(),
        direction: z.enum(["up", "down"]).optional(),
        depth: intParam(1, 20, 20),
        redundancy: boolParam(false),
      }),
      request.query,
      "query parameters",
    );

    return services.relations.graph(params.class, params.id, {
      ...(query.relation !== undefined ? { relation: query.relation } : {}),
      ...(query.direction !== undefined ? { direction: query.direction } : {}),
      depth: query.depth,
      redundancy: query.redundancy,
    });
  });
}
