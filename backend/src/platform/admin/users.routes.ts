import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { idParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

const ids = z.array(z.number().int().positive()).max(200);

/** Account administration. The auth guard keeps /api/admin/* to administrators. */
export function registerUserAdminRoutes(app: FastifyInstance, services: Services): void {
  const { users } = services;

  app.get("/api/admin/users", async (request) => {
    const query = parse(
      z.object({ q: z.string().max(100).optional(), page: intParam(1, 10_000, 1), limit: intParam(1, 200, 25) }),
      request.query,
      "query parameters",
    );
    return users.list({ page: query.page, limit: query.limit, ...(query.q ? { q: query.q } : {}) });
  });

  app.get("/api/admin/profiles", async () => ({ profiles: await users.profiles() }));

  app.get("/api/admin/users/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    return users.get(id);
  });

  app.post("/api/admin/users", async (request, reply) => {
    const body = parse(
      z.object({
        type: z.enum(["local", "ldap", "external"]),
        login: z.string().max(64),
        password: z.string().max(1_024).optional(),
        contact: z.union([
          z.object({ id: z.number().int().positive() }),
          z.object({
            firstName: z.string().max(100),
            lastName: z.string().min(1).max(100),
            email: z.string().email().max(255),
            orgId: z.number().int().positive(),
          }),
        ]),
        profileIds: ids.min(1),
        allowedOrgIds: ids.optional(),
        language: z.string().max(10).optional(),
      }),
      request.body,
      "request body",
    );
    const created = await users.create({
      type: body.type,
      login: body.login,
      contact: body.contact,
      profileIds: body.profileIds,
      ...(body.password ? { password: body.password } : {}),
      ...(body.allowedOrgIds ? { allowedOrgIds: body.allowedOrgIds } : {}),
      ...(body.language ? { language: body.language } : {}),
    });
    reply.code(201);
    return created;
  });

  app.patch("/api/admin/users/:id", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const body = parse(
      z.object({
        status: z.enum(["enabled", "disabled"]).optional(),
        profileIds: ids.optional(),
        allowedOrgIds: ids.optional(),
        contactId: z.number().int().nonnegative().optional(),
        language: z.string().max(10).optional(),
      }),
      request.body,
      "request body",
    );
    return users.update(id, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.profileIds ? { profileIds: body.profileIds } : {}),
      ...(body.allowedOrgIds ? { allowedOrgIds: body.allowedOrgIds } : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
      ...(body.language ? { language: body.language } : {}),
    });
  });

  app.post("/api/admin/users/:id/password", async (request) => {
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const { password } = parse(z.object({ password: z.string().max(1_024) }), request.body, "request body");
    await users.setPassword(id, password);
    return { ok: true };
  });
}
