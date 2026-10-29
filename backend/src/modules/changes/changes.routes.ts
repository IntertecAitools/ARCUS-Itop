import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  blackoutIdParamSchema,
  blackoutSchema,
  cabDecisionSchema,
  calendarQuerySchema,
  changeIdParamSchema,
  pirSchema,
  planRulesSchema,
  plansSchema,
  riskAnswersSchema,
  riskModelSchema,
} from "./changes.schemas.js";

/**
 * HTTP surface for change management. The change record itself (list, form,
 * lifecycle, links) is served by /api/objects/<Class>; its Plan, Implement,
 * Approve and Not approve actions there are checked by the changes service.
 * The plan rules, risk questions and blackout windows are edited under
 * /api/admin (the guard keeps that prefix to the Administrator profile).
 */
export function registerChangeRoutes(app: FastifyInstance, services: Services): void {
  const { changes, changeCalendar, changeRisk, changePir } = services;

  /** Static paths, declared before `/:id`. */
  app.get("/api/changes/cab", async () => changes.queue());

  app.get("/api/changes/calendar", async (request) => {
    const query = parse(calendarQuerySchema, request.query, "query parameters");
    return changeCalendar.calendar(query);
  });

  app.get("/api/changes/blackouts", async () => ({ items: await changeCalendar.blackouts() }));

  app.get("/api/changes/pir-due", async () => changePir.queue());

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

  app.get("/api/changes/:id/risk", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    return changeRisk.get(id);
  });

  app.put("/api/changes/:id/risk", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    const { answers } = parse(riskAnswersSchema, request.body, "request body");
    return changeRisk.answer(id, answers);
  });

  app.get("/api/changes/:id/pir", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    return changePir.get(id);
  });

  app.put("/api/changes/:id/pir", async (request) => {
    const { id } = parse(changeIdParamSchema, request.params, "path parameters");
    const body = parse(pirSchema, request.body, "request body");
    return changePir.save(id, body);
  });

  app.get("/api/admin/change-rules", async () => changes.getRules());

  app.put("/api/admin/change-rules", async (request) => {
    const { rules } = parse(planRulesSchema, request.body, "request body");
    return changes.saveRules(rules);
  });

  app.get("/api/admin/change-risk", async () => changeRisk.getModel());

  app.put("/api/admin/change-risk", async (request) => {
    const { model } = parse(riskModelSchema, request.body, "request body");
    return changeRisk.saveModel(model);
  });

  app.get("/api/admin/change-blackouts", async () => ({ items: await changeCalendar.blackouts() }));

  app.post("/api/admin/change-blackouts", async (request, reply) => {
    const body = parse(blackoutSchema, request.body, "request body");
    const created = await changeCalendar.createBlackout(body);
    reply.code(201);
    return created;
  });

  app.put("/api/admin/change-blackouts/:id", async (request) => {
    const { id } = parse(blackoutIdParamSchema, request.params, "path parameters");
    const body = parse(blackoutSchema, request.body, "request body");
    return changeCalendar.updateBlackout(id, body);
  });

  app.delete("/api/admin/change-blackouts/:id", async (request, reply) => {
    const { id } = parse(blackoutIdParamSchema, request.params, "path parameters");
    await changeCalendar.deleteBlackout(id);
    reply.code(204);
  });
}
