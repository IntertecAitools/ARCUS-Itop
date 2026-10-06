import type { FastifyInstance } from "fastify";

import { AppError } from "../../core/errors.js";
import type { Services } from "../../services.js";

export function registerHealthRoutes(app: FastifyInstance, services: Services): void {
  /** Liveness: does not touch iTop, so it stays up when the backend is down. */
  app.get("/health", async () => ({
    status: "ok",
    service: "arcus-backend",
    schemaClasses: services.schema.classNames.length,
    schemaDiagnostics: services.schema.diagnostics.length,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  /**
   * Readiness: proves the BFF can actually reach iTop and authenticate.
   * Returns 503 rather than throwing so a load balancer gets a clean signal.
   */
  app.get("/health/upstream", async (_request, reply) => {
    const startedAt = Date.now();
    try {
      const authorized = await services.client.checkCredentials();
      const latencyMs = Date.now() - startedAt;

      if (!authorized) {
        reply.code(503);
        return {
          status: "unauthorized",
          latencyMs,
          hint:
            'iTop rejected the configured credentials. Check ITOP_USER/ITOP_PASSWORD, and ' +
            'that the account holds the "REST Services User" profile -- ' +
            "secure_rest_services defaults to true.",
        };
      }

      return { status: "ok", latencyMs, itop: services.config.itop.baseUrl };
    } catch (error) {
      reply.code(503);
      const message = error instanceof AppError ? error.message : (error as Error).message;
      return { status: "unreachable", latencyMs: Date.now() - startedAt, error: message };
    }
  });
}
