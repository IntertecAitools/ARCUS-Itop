import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  analysisSchema,
  createKnownErrorSchema,
  problemIdParamSchema,
  rcaQuerySchema,
  trendQuerySchema,
} from "./problems.schemas.js";

/**
 * HTTP surface for problem management. The problem record itself (list,
 * form, lifecycle, links) is served by /api/objects/Problem.
 */
export function registerProblemRoutes(app: FastifyInstance, services: Services): void {
  const { problems, rca } = services;

  /** Static path, declared before `/:id`. */
  app.get("/api/problems/trends", async (request) => {
    const query = parse(trendQuerySchema, request.query, "query parameters");
    return problems.trends(query);
  });

  app.get("/api/problems/:id/analysis", async (request) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    return problems.getAnalysis(id);
  });

  app.put("/api/problems/:id/analysis", async (request) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    const body = parse(analysisSchema, request.body, "request body");
    return problems.saveAnalysis(id, body);
  });

  /** Evidence and ranked likely causes, from what the caller may read. */
  app.get("/api/problems/:id/rca-evidence", async (request) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    const query = parse(rcaQuerySchema, request.query, "query parameters");
    return rca.evidence(id, query);
  });

  /** An AI draft of the analysis. Saves nothing: the screen fills the form with it. */
  app.post("/api/problems/:id/rca-draft", async (request) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    const query = parse(rcaQuerySchema, request.body ?? {}, "request body");
    return rca.draft(id, query, request.log);
  });

  app.post("/api/problems/:id/known-errors", async (request, reply) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    const body = parse(createKnownErrorSchema, request.body ?? {}, "request body");
    const created = await problems.createKnownError(id, body);
    reply.code(201).header("location", `/api/objects/KnownError/${created.id}`);
    return created;
  });
}
