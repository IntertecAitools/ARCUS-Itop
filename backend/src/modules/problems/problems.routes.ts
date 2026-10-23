import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  analysisSchema,
  createKnownErrorSchema,
  problemIdParamSchema,
  trendQuerySchema,
} from "./problems.schemas.js";

/**
 * HTTP surface for problem management. The problem record itself (list,
 * form, lifecycle, links) is served by /api/objects/Problem.
 */
export function registerProblemRoutes(app: FastifyInstance, services: Services): void {
  const { problems } = services;

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

  app.post("/api/problems/:id/known-errors", async (request, reply) => {
    const { id } = parse(problemIdParamSchema, request.params, "path parameters");
    const body = parse(createKnownErrorSchema, request.body ?? {}, "request body");
    const created = await problems.createKnownError(id, body);
    reply.code(201).header("location", `/api/objects/KnownError/${created.id}`);
    return created;
  });
}
