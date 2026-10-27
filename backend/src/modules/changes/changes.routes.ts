import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { cabDecisionSchema, changeIdParamSchema, planRulesSchema, plansSchema } from "./changes.schemas.js";

/**
 * HTTP surface for change management. The change record itself (list, form,
 * lifecycle, links) is served by /api/objects/<Class>; its Plan, Implement,
 * Approve and Not approve actions there are checked by the changes service.
 * The plan rules are under /api/admin (the guard keeps that prefix to the
 * Administrator profile).
 */
export function registerChangeRoutes(app: FastifyInstance, services: Services): void {
  const { changes } = services;

  /** Static path, declared before `/:id`. */
  app.get("/api/changes/cab", async () => changes.queue());

  app.get("/api/changes/:id/governance", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    return changes.governance(id);
  });

  app.put("/api/changes/:id/plans", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    const body = parse(plansSchema, request.body, "request body");
    return changes.savePlans(id, body);
  });

  app.post("/api/changes/:id/cab-decisions", async (request, reply) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    const body = parse(cabDecisionSchema, request.body, "request body");
    const result = await changes.decide(id, body);
    reply.code(201);
    return result;
  });

  app.get("/api/admin/change-rules", async () => changes.getRules());

  app.put("/api/admin/change-rules", async (request) => {
    const { rules } = parse(planRulesSchema, request.body, "request body");
    return changes.saveRules(rules);
  });
}
