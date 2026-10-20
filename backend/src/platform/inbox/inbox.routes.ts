import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { idParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

/**
 * The bell: the signed-in user's own in-app notifications. Open to staff and
 * end users alike (the guard lets /api/me/ through for both).
 */
export function registerInboxRoutes(app: FastifyInstance, services: Services): void {
  const { inbox } = services;

  app.get("/api/me/notifications", async (request) => {
    const query = parse(
      z.object({
        limit: intParam(1, 100, 30),
        unread: z.enum(["true", "false"]).optional(),
      }),
      request.query,
      "query parameters",
    );
    return inbox.list(query.limit, query.unread === "true");
  });

  /** Cheap: polled by the top bar for the badge. */
  app.get("/api/me/notifications/count", async () => ({ unread: await inbox.unreadCount() }));

  app.post("/api/me/notifications/:id/read", async (request, reply) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    await inbox.markRead(id);
    reply.code(204);
    return null;
  });

  app.post("/api/me/notifications/read-all", async () => ({ marked: await inbox.markAllRead() }));
}
