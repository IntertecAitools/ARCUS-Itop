import type { FastifyInstance } from "fastify";

import { AppError } from "../../core/errors.js";
import type { Services } from "../../services.js";
import type { IntakeStatus } from "./mail-intake.types.js";

const OFF: IntakeStatus = { enabled: false, totals: { created: 0, updated: 0, skipped: 0, failed: 0 } };

/**
 * Email to ticket. The poller starts with the server when MAIL_INTAKE_SOURCE
 * is set; administrators can see its last run and start one now (under
 * /api/admin/, which only administrators pass).
 */
export function registerMailIntakeRoutes(app: FastifyInstance, services: Services): void {
  const intake = services.mailIntake;

  if (intake) {
    app.addHook("onReady", async () => intake.start());
    app.addHook("onClose", async () => intake.stop());
  }

  app.get("/api/admin/mail-intake", async () => intake?.status() ?? OFF);

  app.post("/api/admin/mail-intake/run", async () => {
    if (!intake) {
      throw new AppError("conflict", "Email to ticket is off: set MAIL_INTAKE_SOURCE (backend/README.md, \"Email to ticket\").");
    }
    return intake.run();
  });
}
