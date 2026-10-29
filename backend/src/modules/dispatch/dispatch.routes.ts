import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { assignmentRulesSchema, ruleTestSchema, takeParamSchema } from "./dispatch.schemas.js";
import type { AssignmentRules, RoutingFacts } from "./dispatch.types.js";

/**
 * HTTP surface for team dispatch. Dispatching itself is a lifecycle action
 * (`dispatch` on /api/incidents/:id/transitions, `ev_dispatch` on
 * /api/objects/UserRequest/:id/stimulus); these are the team's queue,
 * "Take it" and the assignment rules (under /api/admin, which the guard
 * keeps to the Administrator profile).
 */
export function registerDispatchRoutes(app: FastifyInstance, services: Services): void {
  const { dispatch } = services;

  app.get("/api/dispatch/queue", async () => dispatch.queue());

  app.post("/api/dispatch/:type/:id/take", async (request) => {
    const { type, id } = parse(takeParamSchema, request.params, "path parameters");
    return dispatch.take(type, id);
  });

  app.get("/api/admin/assignment-rules", async () => dispatch.getRules());

  app.put("/api/admin/assignment-rules", async (request) => {
    const body = parse(assignmentRulesSchema, request.body, "request body");
    return dispatch.saveRules(body as AssignmentRules);
  });

  /** Which rule would route a ticket like this one. */
  app.post("/api/admin/assignment-rules/test", async (request) => {
    const facts = parse(ruleTestSchema, request.body, "request body");
    return dispatch.test(facts as RoutingFacts);
  });
}
