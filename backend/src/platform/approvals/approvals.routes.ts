import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AppError, notFound } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import { idParam, parse } from "../../core/validate.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { Services } from "../../services.js";
import { ensureApprovalNotifications } from "./approval-notifications.js";

const idParams = z.object({ id: idParam });
const answerBody = z.object({ comment: z.string().max(5_000).default("") });

/**
 * Approvals.
 *
 * `/api/me/approvals` is the signed-in user's own: what waits for their
 * answer, what they decided, and answering. Approvers are staff and end
 * users alike, so it lives under /api/me/, which the guard opens to both.
 *
 * The approval on one request is shown with the request: to staff who can
 * read it (`/api/approvals/requests/:id`), and to end users on their own
 * requests (`/api/portal/requests/:id/approval`, inside the portal's scope).
 */
export function registerApprovalRoutes(app: FastifyInstance, services: Services): void {
  const { approvals, portal, client, notifications, config } = services;

  app.get("/api/me/approvals", async (request) => {
    const query = parse(
      z.object({ state: z.enum(["pending", "decided"]).default("pending") }),
      request.query,
      "query parameters",
    );
    return approvals.list(query.state);
  });

  /** Cheap enough to poll: the sidebar and portal badge. */
  app.get("/api/me/approvals/count", async () => ({ pending: await approvals.pendingCount() }));

  app.get("/api/me/approvals/:id", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    return approvals.get(id);
  });

  app.post("/api/me/approvals/:id/approve", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const { comment } = parse(answerBody, request.body ?? {}, "request body");
    return approvals.answer(id, "approved", comment);
  });

  app.post("/api/me/approvals/:id/reject", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const { comment } = parse(answerBody, request.body ?? {}, "request body");
    return approvals.answer(id, "rejected", comment);
  });

  app.get("/api/approvals/requests/:id", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    // Read as the staff member themselves: if iTop will not show them the
    // request, they do not see its approval either.
    const result = await client.call("core/get", {
      class: "UserRequest",
      key: `SELECT UserRequest WHERE id = ${id}`,
      output_fields: "id",
      limit: 1,
    });
    if (normalizeObjects(result.objects).length === 0) throw notFound(`No request ${id}.`);
    return { approval: await approvals.forRequest(id) };
  });

  app.get("/api/portal/requests/:id/approval", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    // The portal's scope check: their own (or their organisation's) ticket.
    const host = await portal.attachmentHost(caller, id);
    return { approval: host === "UserRequest" ? await approvals.forRequest(id) : null };
  });

  /** Administrators: (re)creates the approval emails and bell entries. Idempotent. */
  app.post("/api/admin/approvals/notifications", async () =>
    ensureApprovalNotifications(client, notifications, {
      appBaseUrl: config.appBaseUrl,
      sender: config.notificationSender,
    }),
  );
}
