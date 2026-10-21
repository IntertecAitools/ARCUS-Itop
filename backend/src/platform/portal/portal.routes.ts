import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors.js";
import { currentCaller, runAsServiceAccount, type Caller } from "../../core/request-context.js";
import { idParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { readUpload, sendAttachment } from "../../modules/attachments/attachments.routes.js";

function caller(): Caller {
  const c = currentCaller();
  if (!c) throw new AppError("unauthorized", "Sign in to continue.");
  return c;
}

const idParams = z.object({ id: idParam });

/**
 * The self-service portal API: what an end user can see and do, scoped by
 * PortalService the way iTop's own portal scopes it. The auth guard lets
 * end-user sessions reach only this and /api/auth.
 */
export function registerPortalRoutes(app: FastifyInstance, services: Services): void {
  const { portal, attachments } = services;

  app.get("/api/portal/requests", async (request) => {
    const query = parse(
      z.object({
        state: z.enum(["open", "closed"]).default("open"),
        q: z.string().max(200).optional(),
        page: intParam(1, 1_000, 1),
        limit: intParam(1, 100, 20),
      }),
      request.query,
      "query parameters",
    );
    return portal.listTickets(caller(), {
      closed: query.state === "closed",
      page: query.page,
      limit: query.limit,
      ...(query.q ? { q: query.q } : {}),
    });
  });

  app.post("/api/portal/requests", async (request, reply) => {
    const body = parse(
      z.object({
        title: z.string().max(255),
        description: z.string().max(20_000),
        serviceId: z.number().int().positive().optional(),
        subcategoryId: z.number().int().positive().optional(),
        urgency: z.enum(["1", "2", "3", "4"]).optional(),
      }),
      request.body,
      "request body",
    );
    const created = await portal.createRequest(caller(), {
      title: body.title,
      description: body.description,
      ...(body.serviceId !== undefined ? { serviceId: body.serviceId } : {}),
      ...(body.subcategoryId !== undefined ? { subcategoryId: body.subcategoryId } : {}),
      ...(body.urgency ? { urgency: body.urgency } : {}),
    });
    reply.code(201);
    return created;
  });

  app.get("/api/portal/requests/:id", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    return portal.getTicket(caller(), id);
  });

  app.post("/api/portal/requests/:id/comments", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const { message } = parse(z.object({ message: z.string().max(20_000) }), request.body, "request body");
    return portal.comment(caller(), id, message);
  });

  app.post("/api/portal/requests/:id/close", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const body = parse(
      z.object({ satisfaction: z.enum(["1", "2", "3", "4"]).optional(), comment: z.string().max(5_000).optional() }),
      request.body ?? {},
      "request body",
    );
    return portal.act(caller(), id, "close", {
      ...(body.satisfaction ? { satisfaction: body.satisfaction } : {}),
      ...(body.comment ? { comment: body.comment } : {}),
    });
  });

  app.post("/api/portal/requests/:id/reopen", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const { message } = parse(z.object({ message: z.string().max(20_000) }), request.body, "request body");
    return portal.act(caller(), id, "reopen", { message });
  });

  // Attachments on the user's own tickets: the scope check resolves the host
  // class, then the shared attachment service does the work, as the service
  // account (iTop refuses end users; the scope check is the access control).
  app.get("/api/portal/requests/:id/attachments", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const host = await portal.attachmentHost(caller(), id);
    return runAsServiceAccount(() => attachments.list(host, String(id)));
  });

  app.post("/api/portal/requests/:id/attachments", async (request, reply) => {
    const { id } = parse(idParams, request.params, "path parameters");
    const who = caller();
    const host = await portal.attachmentHost(who, id);
    const upload = await readUpload(request);
    // Written with the service account (end users cannot reach iTop), but
    // recorded under the end user.
    const created = await runAsServiceAccount(() =>
      attachments.upload(host, String(id), upload, {
        userId: who.userId,
        contactId: who.contactId,
        login: who.login,
      }),
    );
    reply.code(201);
    return created;
  });

  app.get("/api/portal/requests/:id/attachments/:attachmentId", async (request, reply) => {
    const { id, attachmentId } = parse(
      z.object({ id: idParam, attachmentId: idParam }),
      request.params,
      "path parameters",
    );
    const host = await portal.attachmentHost(caller(), id);
    const file = await runAsServiceAccount(() => attachments.download(host, String(id), String(attachmentId)));
    return sendAttachment(reply, file);
  });

  app.get("/api/portal/catalog", async () => portal.catalog(caller()));

  app.get("/api/portal/faqs", async (request) => {
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), request.query, "query parameters");
    return portal.faqs(q);
  });

  app.get("/api/portal/faqs/:id", async (request) => {
    const { id } = parse(idParams, request.params, "path parameters");
    return portal.faq(id);
  });

  app.get("/api/portal/profile", async () => portal.profile(caller()));

  app.patch("/api/portal/profile", async (request) => {
    const body = parse(
      z.object({ phone: z.string().max(64).optional(), mobilePhone: z.string().max(64).optional() }),
      request.body,
      "request body",
    );
    return portal.updateProfile(caller(), {
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.mobilePhone !== undefined ? { mobilePhone: body.mobilePhone } : {}),
    });
  });
}
