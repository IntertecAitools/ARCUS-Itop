import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { badRequest } from "../../core/errors.js";
import {
  boolParam,
  identifierParam,
  idParam,
  intParam,
  parse,
} from "../../core/validate.js";
import { DEFAULT_PAGE_SIZE, MAX_BULK_IDS, MAX_PAGE_SIZE } from "./objects.service.js";
import { parseCriteriaParam } from "./criteria.js";
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
  "view",
  "strict",
  "comment",
  "simulate",
  "criteria",
]);

const listQuerySchema = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  q: z.string().max(200).optional(),
  sort: identifierParam.optional(),
  order: z.enum(["asc", "desc"]).optional(),
  fields: z.string().max(2_000).optional(),
  oql: z.string().max(4_000).optional(),
  /** Advanced-search criteria as a JSON array; see criteria.ts. */
  criteria: z.string().max(8_000).optional(),
  /**
   * A navigation view id, e.g. `Incident:OpenIncidents`. The BFF resolves it to
   * the OQL iTop declares for that menu, so the frontend can render "Open
   * incidents" without ever holding a query. Menu ids contain a colon, so this
   * cannot use `identifierParam`.
   */
  view: z
    .string()
    .max(120)
    .regex(/^[A-Za-z0-9_:-]+$/, "a view id may only contain letters, digits, _, - and :")
    .optional(),
});

const writeBodySchema = z.object({
  fields: z.record(z.unknown()),
  comment: z.string().max(500).optional(),
  /** When false, unwritable attributes are dropped instead of rejected. */
  strict: z.boolean().optional(),
  /** Attributes to return on the created/updated object. */
  returnFields: z.string().max(2_000).optional(),
});

/** Extracts the query params not in `reserved` as exact-match filters. */
export function extractFilters(query: unknown, reserved: ReadonlySet<string>): Record<string, string> {
  const filters: Record<string, string> = {};
  if (typeof query !== "object" || query === null) return filters;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (reserved.has(key)) continue;
    // Repeated params arrive as arrays; only the first is meaningful for an
    // equality filter, and silently ORing them would be surprising.
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string" || typeof single === "number") {
      filters[key] = String(single);
    }
  }
  return filters;
}

/**
 * The OQL behind `?view=` (or a raw `?oql=`). Resolving it here keeps iTop's
 * query language on this side of the boundary; a view id is all the frontend
 * ever sends.
 */
export async function resolveViewOql(
  services: Services,
  className: string,
  viewId: string | undefined,
  rawOql: string | undefined,
): Promise<string | undefined> {
  if (viewId === undefined) return rawOql;
  const view = services.navigation.resolveView(viewId);
  if (view.class !== className) {
    throw badRequest(`View "${viewId}" lists ${view.class}, not ${className}.`);
  }
  if (rawOql !== undefined) {
    throw badRequest("Pass either `view` or `oql`, not both.");
  }
  // "My incidents"-style views filter on :current_contact_id. Binding it here
  // keeps the parameter server-side: the frontend only ever sends the view id,
  // never a contact. Until the frontend has its own sign-in, the current
  // contact is the account the BFF authenticates as.
  if (!view.needsContact) return view.oql;
  const contactId = await services.currentContact.resolve();
  return view.oql.split(":current_contact_id").join(contactId);
}

export function registerObjectRoutes(app: FastifyInstance, services: Services): void {
  const { objects } = services;


  app.get("/api/objects/:class", async (request) => {
    const { class: className } = parse(
      z.object({ class: identifierParam }),
      request.params,
      "path parameters",
    );
    const query = parse(listQuerySchema, request.query, "query parameters");
    const filters = extractFilters(request.query, RESERVED_QUERY_KEYS);
    const oql = await resolveViewOql(services, className, query.view, query.oql);

    return objects.list(className, {
      page: query.page,
      limit: query.limit,
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
      ...(query.order !== undefined ? { order: query.order } : {}),
      ...(query.fields !== undefined ? { fields: query.fields } : {}),
      ...(oql !== undefined ? { oql } : {}),
      criteria: parseCriteriaParam(query.criteria),
      filters,
    });
  });

  const bulkIds = z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS);

  /**
   * One action on many records: `update` (same values on each), `stimulus`
   * (a lifecycle action, with the fields its target state needs) or `delete`.
   * Answers 200 with a per-record outcome even when some fail.
   */
  app.post("/api/objects/:class/bulk", async (request) => {
    const { class: className } = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const body = parse(
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("update"), ids: bulkIds, fields: z.record(z.unknown()), comment: z.string().max(500).optional() }),
        z.object({
          action: z.literal("stimulus"),
          ids: bulkIds,
          stimulus: identifierParam,
          fields: z.record(z.unknown()).optional(),
          comment: z.string().max(500).optional(),
        }),
        z.object({ action: z.literal("delete"), ids: bulkIds, comment: z.string().max(500).optional() }),
      ]),
      request.body,
      "request body",
    );
    const { ids, comment, ...action } = body;
    return objects.bulk(className, ids, action, comment);
  });

  /** The combined deletion plan for several records, without deleting. */
  app.post("/api/objects/:class/bulk/delete-plan", async (request) => {
    const { class: className } = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const { ids } = parse(z.object({ ids: bulkIds }), request.body, "request body");
    return objects.bulkDeletePlan(className, ids);
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

  /**
   * Add one object to a link set: `{ targetId, fields? }`. For an n-n set the
   * target is the far object (a Person for Team.persons_list) and `fields`
   * are the link's own attributes; for a 1-n set it is the object to attach.
   */
  app.post("/api/objects/:class/:id/links/:attcode", async (request, reply) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam, attcode: identifierParam }),
      request.params,
      "path parameters",
    );
    const body = parse(
      z.object({
        targetId: z.number().int().positive(),
        fields: z.record(z.unknown()).optional(),
      }),
      request.body,
      "request body",
    );
    const created = await objects.addLink(
      params.class,
      params.id,
      params.attcode,
      body.targetId,
      body.fields ?? {},
    );
    reply.code(201);
    return created;
  });

  /**
   * Remove one entry from a link set. `itemId` is the row id the links
   * listing returned: the link row for n-n, the attached object for 1-n.
   */
  app.delete("/api/objects/:class/:id/links/:attcode/:itemId", async (request, reply) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam, attcode: identifierParam, itemId: idParam }),
      request.params,
      "path parameters",
    );
    await objects.removeLink(params.class, params.id, params.attcode, params.itemId);
    reply.code(204);
    return null;
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
