import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { autoCloseSettingsSchema } from "./auto-close.schemas.js";

/**
 * Closing resolved tickets by themselves. The background check starts with
 * the server (AUTO_CLOSE_CHECK_MINUTES, 0 = off); the settings and "run
 * now" are under /api/admin/, which only administrators pass.
 */
export function registerAutoCloseRoutes(app: FastifyInstance, services: Services): void {
  const { autoClose } = services;

  app.addHook("onReady", async () => autoClose.start());
  app.addHook("onClose", async () => autoClose.stop());

  app.get("/api/admin/auto-close", async () => autoClose.get());

  app.put("/api/admin/auto-close", async (request) => {
    const body = parse(autoCloseSettingsSchema, request.body, "request body");
    return autoClose.save(body);
  });

  /** One check now, for the caller's own tenant. */
  app.post("/api/admin/auto-close/run", async () => autoClose.runCurrent());
}
