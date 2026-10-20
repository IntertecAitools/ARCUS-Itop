import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { criteriaSchema } from "../objects/criteria.js";
import { EDITABLE_EVENTS, type RuleInput } from "./notifications.service.js";

const recipient = z.union([
  z.object({ kind: z.enum(["caller", "agent", "team", "mentioned"]) }),
  z.object({ kind: z.literal("people"), ids: z.array(z.number().int().positive()).min(1).max(50) }),
  z.object({ kind: z.literal("custom"), index: z.number().int().min(0).max(50) }),
]);

const ruleSchema = z.object({
  name: z.string().max(255),
  event: z.object({
    kind: z.enum(EDITABLE_EVENTS),
    recordType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(64),
    state: z.string().max(64).optional(),
    fields: z.array(z.string().regex(/^[a-z0-9_]+$/).max(64)).max(50).optional(),
    sla: z.object({ timer: z.string().max(16), percent: z.string().max(4) }).optional(),
    conditions: criteriaSchema.optional(),
    keepCondition: z.boolean().optional(),
  }),
  email: z.object({
    to: z.array(recipient).max(20),
    cc: z.array(recipient).max(20),
    subject: z.string().max(255),
    body: z.string().max(20_000),
    status: z.enum(["on", "test", "off"]),
    testRecipient: z.string().max(255).optional(),
  }),
  inApp: z.object({ on: z.boolean(), message: z.string().max(255) }).optional(),
});

/**
 * Email notification rules. Under /api/admin, so the auth guard keeps them to
 * administrators; iTop then applies the administrator's own rights.
 */
export function registerNotificationRoutes(app: FastifyInstance, services: Services): void {
  const { notifications } = services;

  app.get("/api/admin/notifications/rules", async () => ({ rules: await notifications.list() }));

  app.get("/api/admin/notifications/rules/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    return notifications.getRule(id);
  });

  app.get("/api/admin/notifications/options", async (request) => {
    const { recordType } = parse(
      z.object({ recordType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(64).optional() }),
      request.query,
      "query parameters",
    );
    return notifications.options(recordType);
  });

  app.post("/api/admin/notifications/rules", async (request, reply) => {
    const body = parse(ruleSchema, request.body, "request body") as RuleInput;
    const rule = await notifications.create(body);
    reply.code(201);
    return rule;
  });

  app.put("/api/admin/notifications/rules/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const body = parse(ruleSchema, request.body, "request body") as RuleInput;
    return notifications.update(id, body);
  });

  app.patch("/api/admin/notifications/rules/:id/status", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const { status } = parse(z.object({ status: z.enum(["on", "test", "off"]) }), request.body, "request body");
    return notifications.setStatus(id, status);
  });

  app.delete("/api/admin/notifications/rules/:id", async (request, reply) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    await notifications.remove(id);
    reply.code(204);
    return null;
  });

  app.get("/api/admin/notifications/sent", async () => ({ sent: await notifications.sent() }));
}
