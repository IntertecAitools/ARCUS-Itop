import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  articleActionSchema,
  articleListQuerySchema,
  articleParamsSchema,
  feedbackSchema,
  knowledgeSettingsSchema,
} from "./knowledge.schemas.js";

/**
 * HTTP surface for knowledge articles. Their content is edited on the
 * generic record screens (/api/objects/FAQ, /api/objects/KnownError); this
 * is the workflow and the feedback around them. Reviewer settings are under
 * /api/admin. The portal's own article routes are in platform/portal.
 */
export function registerKnowledgeRoutes(app: FastifyInstance, services: Services): void {
  const { knowledge } = services;

  app.get("/api/knowledge/articles", async (request) => {
    const query = parse(articleListQuerySchema, request.query, "query parameters");
    return knowledge.list(query);
  });

  app.get("/api/knowledge/articles/:kind/:id", async (request) => {
    const { kind, id } = parse(articleParamsSchema, request.params, "path parameters");
    return knowledge.get(kind, id);
  });

  app.post("/api/knowledge/articles/:kind/:id/actions", async (request) => {
    const { kind, id } = parse(articleParamsSchema, request.params, "path parameters");
    const body = parse(articleActionSchema, request.body, "request body");
    return knowledge.act(kind, id, body);
  });

  app.post("/api/knowledge/articles/:kind/:id/feedback", async (request) => {
    const { kind, id } = parse(articleParamsSchema, request.params, "path parameters");
    const body = parse(feedbackSchema, request.body, "request body");
    return knowledge.feedback(kind, id, body, "staff");
  });

  app.get("/api/admin/knowledge-settings", async () => knowledge.getSettings());

  app.put("/api/admin/knowledge-settings", async (request) => {
    const body = parse(knowledgeSettingsSchema, request.body, "request body");
    return knowledge.saveSettings(body);
  });
}
