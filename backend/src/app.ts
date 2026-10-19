import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";

import type { Config } from "./config/env.js";
import { AppError } from "./core/errors.js";
import { registerCors } from "./core/cors.js";
import { assertNoDuplicatePaths, modules } from "./config/modules.js";
import { registerHealthRoutes } from "./platform/health/health.routes.js";
import { registerLookupRoutes } from "./platform/lookups/lookups.routes.js";
import { registerMetaRoutes } from "./platform/meta/meta.routes.js";
import { registerAttachmentRoutes } from "./modules/attachments/attachments.routes.js";
import { registerNavigationRoutes } from "./platform/navigation/navigation.routes.js";
import { registerDashboardRoutes } from "./platform/dashboards/dashboards.routes.js";
import { registerObjectRoutes } from "./platform/objects/objects.routes.js";
import { registerHistoryRoutes } from "./platform/history/history.routes.js";
import { registerTransferRoutes } from "./platform/transfer/transfer.routes.js";
import { registerAuth } from "./platform/auth/auth.routes.js";
import { registerUserAdminRoutes } from "./platform/admin/users.routes.js";
import { registerPortalRoutes } from "./platform/portal/portal.routes.js";
import { buildServices, type BuildServicesOptions, type Services } from "./services.js";

export interface BuildAppResult {
  app: FastifyInstance;
  services: Services;
}

export function buildApp(config: Config, options: BuildServicesOptions = {}): BuildAppResult {
  const app = Fastify({
    trustProxy: config.server.trustProxy,
    logger: {
      level: config.server.logLevel,
      // The password is only ever in the outgoing form body, never in a logged
      // object, but redact defensively in case a future change logs the request.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "auth_pwd", "password"],
        censor: "[redacted]",
      },
    },
    // Fastify's default 1MB body limit is generous for field maps and keeps a
    // malformed client from buffering unbounded JSON.
    bodyLimit: 1_048_576,
    // Avoid trusting client-supplied request ids, which end up in logs.
    requestIdHeader: false,
  });

  registerCors(app, config.corsOrigins);

  // File uploads. Registered before the routes that use it; the per-request
  // limit is enforced in the attachment route, which can report it properly.
  app.register(multipart);

  const services = buildServices(config, {
    ...options,
    logger: options.logger ?? app.log,
  });

  // Platform routes are infrastructure, not business modules: health checks,
  // schema introspection and generic access to any iTop class. They are always
  // on, because every module is built on top of them.
  // First: the guard binds the signed-in user to every request after it.
  registerAuth(app, services);
  app.addHook("onClose", async () => services.sessions.close());

  registerHealthRoutes(app, services);
  registerMetaRoutes(app, services);
  registerNavigationRoutes(app, services);
  registerDashboardRoutes(app, services);
  registerObjectRoutes(app, services);
  registerHistoryRoutes(app, services);
  registerTransferRoutes(app, services);
  registerUserAdminRoutes(app, services);
  registerPortalRoutes(app, services);
  registerLookupRoutes(app, services);
  registerAttachmentRoutes(app, services);

  // Business modules come from the registry — this file never names one.
  // Adding a module is one entry in src/config/modules.ts and nothing here.
  assertNoDuplicatePaths();
  for (const module of modules) {
    module.register(app, services);
    app.log.debug({ module: module.id, basePath: module.basePath }, "module registered");
  }

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: "not_found",
        message: `No route for ${request.method} ${request.url}.`,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      // 4xx is the caller's problem and only worth a debug line; 5xx is ours.
      const logLine = { err: error, code: error.code, itopCode: error.itopCode };
      if (error.status >= 500) {
        request.log.error(logLine, error.message);
      } else {
        request.log.debug(logLine, error.message);
      }
      reply.code(error.status).send(error.toPayload());
      return;
    }

    // Fastify's own errors (malformed JSON body, unsupported media type) carry a
    // statusCode; anything else is an unexpected throw and becomes a 500.
    const fastifyError = error as { statusCode?: unknown; message?: unknown };
    const status =
      typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Unhandled error");
    }

    // Keep the code in step with the status, so a 413 from the body limit or a
    // 415 from the content-type parser does not read as a generic 400.
    const code =
      status >= 500
        ? "internal_error"
        : ({ 404: "not_found", 413: "payload_too_large", 415: "unsupported_media_type" } as const)[
            status as 404 | 413 | 415
          ] ?? "bad_request";

    reply.code(status).send({
      error: {
        code,
        // Never leak an internal stack or message to the client on a 500.
        message:
          status >= 500
            ? "Internal server error."
            : typeof fastifyError.message === "string"
              ? fastifyError.message
              : "Bad request.",
      },
    });
  });

  return { app, services };
}
