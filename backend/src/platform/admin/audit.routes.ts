import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { criteriaSchema } from "../objects/criteria.js";
import type { CategoryInput, DomainInput, RuleInput } from "./audit.service.js";

const idOnly = z.object({ id: idParam });
const percent = z.number().int().min(0).max(100);

const categorySchema = z.object({
  name: z.string().max(255),
  description: z.string().max(255).optional(),
  recordType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(64),
  conditions: criteriaSchema.optional(),
  keepCondition: z.boolean().optional(),
  tolerance: z.object({ good: percent, warning: percent }).optional(),
  domains: z.array(z.number().int().positive()).max(50).optional(),
});

const ruleSchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().max(255),
  description: z.string().max(255).optional(),
  lists: z.enum(["faulty", "valid"]),
  conditions: criteriaSchema.optional(),
  keepCondition: z.boolean().optional(),
});

const domainSchema = z.object({
  name: z.string().max(255),
  description: z.string().max(255).optional(),
});

/**
 * iTop's data-quality audit. Under /api/admin, so the auth guard keeps it to
 * administrators; the checks then run with the administrator's own rights.
 */
export function registerAuditRoutes(app: FastifyInstance, services: Services): void {
  const { audit } = services;

  app.get("/api/admin/audit", async () => audit.overview());

  app.get("/api/admin/audit/options", async () => audit.options());

  app.post("/api/admin/audit/categories/:id/run", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    return audit.runCategory(id);
  });

  app.post("/api/admin/audit/rules/:id/run", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    return audit.runRule(id);
  });

  // Categories
  app.get("/api/admin/audit/categories/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    return audit.getCategory(id);
  });

  app.post("/api/admin/audit/categories", async (request, reply) => {
    const body = parse(categorySchema, request.body, "request body") as CategoryInput;
    const category = await audit.createCategory(body);
    reply.code(201);
    return category;
  });

  app.put("/api/admin/audit/categories/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    const body = parse(categorySchema, request.body, "request body") as CategoryInput;
    return audit.updateCategory(id, body);
  });

  // ?withRules=true deletes the category's rules with it; without it, a
  // category that has rules answers 409 naming them.
  app.delete("/api/admin/audit/categories/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    const { withRules } = parse(
      z.object({ withRules: z.enum(["true", "false"]).optional() }),
      request.query,
      "query parameters",
    );
    return audit.deleteCategory(id, withRules === "true");
  });

  // Rules
  app.get("/api/admin/audit/rules/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    return audit.getRule(id);
  });

  app.post("/api/admin/audit/rules", async (request, reply) => {
    const body = parse(ruleSchema, request.body, "request body") as RuleInput;
    const rule = await audit.createRule(body);
    reply.code(201);
    return rule;
  });

  app.put("/api/admin/audit/rules/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    const body = parse(ruleSchema, request.body, "request body") as RuleInput;
    return audit.updateRule(id, body);
  });

  app.delete("/api/admin/audit/rules/:id", async (request, reply) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    await audit.deleteRule(id);
    reply.code(204);
    return null;
  });

  // Domains
  app.post("/api/admin/audit/domains", async (request, reply) => {
    const body = parse(domainSchema, request.body, "request body") as DomainInput;
    const domain = await audit.createDomain(body);
    reply.code(201);
    return domain;
  });

  app.put("/api/admin/audit/domains/:id", async (request) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    const body = parse(domainSchema, request.body, "request body") as DomainInput;
    return audit.updateDomain(id, body);
  });

  app.delete("/api/admin/audit/domains/:id", async (request, reply) => {
    const { id } = parse(idOnly, request.params, "path parameters");
    await audit.deleteDomain(id);
    reply.code(204);
    return null;
  });
}
