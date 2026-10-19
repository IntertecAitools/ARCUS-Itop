import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { identifierParam, idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

export function registerHistoryRoutes(app: FastifyInstance, services: Services): void {
  /** A record's change history, newest first, worded for a person to read. */
  app.get("/api/objects/:class/:id/history", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, id: idParam }),
      request.params,
      "path parameters",
    );
    return services.history.forObject(params.class, params.id);
  });
}
