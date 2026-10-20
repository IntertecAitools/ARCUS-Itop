import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

/**
 * iTop's data-quality audit. Under /api/admin, so the auth guard keeps it to
 * administrators; the checks then run with the administrator's own rights.
 */
export function registerAuditRoutes(app: FastifyInstance, services: Services): void {
  const { audit } = services;

  app.get("/api/admin/audit", async () => audit.overview());

  app.post("/api/admin/audit/categories/:id/run", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    return audit.runCategory(id);
  });

  app.post("/api/admin/audit/rules/:id/run", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    return audit.runRule(id);
  });
}
