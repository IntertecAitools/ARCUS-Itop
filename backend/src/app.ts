import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config/env.js";
import { AppError } from "./core/errors.js";
import { registerCors } from "./core/cors.js";
import { assertNoDuplicatePaths, modules } from "./config/modules.js";
import { registerHealthRoutes } from "./platform/health/health.routes.js";
import { registerLookupRoutes } from "./platform/lookups/lookups.routes.js";
import { registerMetaRoutes } from "./platform/meta/meta.routes.js";
import { registerNavigationRoutes } from "./platform/navigation/navigation.routes.js";
import { registerObjectRoutes } from "./platform/objects/objects.routes.js";
import { buildServices, type BuildServicesOptions, type Services } from "./services.js";

export interface BuildAppResult {
  app: FastifyInstance;
  services: Services;
}

export function buildApp(config: Config, options: BuildServicesOptions = {}): BuildAppResult {
  const app = Fastify({
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

  const services = buildServices(config, {
    ...options,
    logger: options.logger ?? app.log,
  });

  // Platform routes are infrastructure, not business modules: health checks,
  // schema introspection and generic access to any iTop class. They are always
  // on, because every module is built on top of them.
  registerHealthRoutes(app, services);
  registerMetaRoutes(app, services);
  registerNavigationRoutes(app, services);
  registerObjectRoutes(app, services);
  registerLookupRoutes(app, services);

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

    reply.code(status).send({
      error: {
        code: status >= 500 ? "internal_error" : "bad_request",
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
