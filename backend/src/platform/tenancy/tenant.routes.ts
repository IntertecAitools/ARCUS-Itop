import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { notFound } from "../../core/errors.js";
import { currentTenant } from "../../core/request-context.js";
import { idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { brandingView } from "./tenant-admin.service.js";

const tenantId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const tenantParams = z.object({ tenant: tenantId });
const status = z.enum(["active", "inactive"]);

/**
 * Branding (public: the sign-in page needs it before anyone signs in) and
 * a customer's own administration. The auth guard keeps /api/admin/* to
 * administrators; TenantAdminService keeps each to their own tenant.
 */
export function registerTenantRoutes(app: FastifyInstance, services: Services): void {
  const { tenantAdmin, tenantStore } = services;

  /**
   * The branding of the site this request is for: the tenant of its host
   * name, or of the signed-in user. Null on the platform's own address, and
   * with tenancy off: the app keeps its built-in look.
   */
  app.get("/api/branding", async () => {
    const bound = currentTenant();
    const tenant = bound ? (await tenantStore.list()).find((t) => t.id === bound.id) : undefined;
    if (!tenant) return { branding: null };
    return { branding: { tenantId: tenant.id, tenantName: tenant.name, ...brandingView(tenant) } };
  });

  /**
   * A tenant's logo, by tenant id, for <img>. Served with a CSP that lets
   * nothing run, so an SVG opened directly cannot script the site either.
   */
  app.get("/api/branding/logo/:tenant", async (request, reply) => {
    const { tenant: id } = parse(tenantParams, request.params, "path parameters");
    const logo = (await tenantStore.list()).find((t) => t.id === id)?.branding?.logo;
    const match = logo ? /^data:(image\/[a-z+]+);base64,(.*)$/.exec(logo) : null;
    if (!match) throw notFound("No logo.");
    reply
      .header("Content-Type", match[1]!)
      .header("Cache-Control", "public, max-age=86400")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(Buffer.from(match[2]!, "base64"));
  });

  app.get("/api/admin/tenants", async () => tenantAdmin.list());

  app.get("/api/admin/tenants/:tenant", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    return tenantAdmin.get(tenant);
  });

  app.put("/api/admin/tenants/:tenant/branding", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const body = parse(
      z.object({
        productName: z.string().max(100).optional(),
        accentColor: z.string().max(20).optional(),
        // A data URL; the store checks its type and size.
        logo: z.string().max(400_000).optional(),
      }),
      request.body,
      "request body",
    );
    return tenantAdmin.setBranding(tenant, body);
  });

  app.put("/api/admin/tenants/:tenant/email-domains", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const body = parse(
      z.object({
        emailDomains: z.array(z.object({ domain: z.string().max(255), orgId: z.number().int().positive() })).max(100),
      }),
      request.body,
      "request body",
    );
    return tenantAdmin.setEmailDomains(tenant, body.emailDomains);
  });

  app.put("/api/admin/tenants/:tenant/hostnames", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const body = parse(z.object({ hostnames: z.array(z.string().max(255)).max(50) }), request.body, "request body");
    return tenantAdmin.setHostnames(tenant, body.hostnames);
  });

  app.get("/api/admin/tenants/:tenant/orgs", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    return { items: await tenantAdmin.orgs(tenant) };
  });

  app.post("/api/admin/tenants/:tenant/orgs", async (request, reply) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const body = parse(
      z.object({
        name: z.string().max(255),
        code: z.string().max(64).optional(),
        parentId: z.number().int().positive().optional(),
      }),
      request.body,
      "request body",
    );
    reply.code(201);
    return tenantAdmin.createOrg(tenant, body);
  });

  app.patch("/api/admin/tenants/:tenant/orgs/:id", async (request) => {
    const { tenant, id } = parse(tenantParams.extend({ id: idParam }), request.params, "path parameters");
    const body = parse(
      z.object({ name: z.string().max(255).optional(), code: z.string().max(64).optional(), status: status.optional() }),
      request.body,
      "request body",
    );
    return tenantAdmin.updateOrg(tenant, id, body);
  });

  app.get("/api/admin/tenants/:tenant/teams", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    return { items: await tenantAdmin.teams(tenant) };
  });

  app.post("/api/admin/tenants/:tenant/teams", async (request, reply) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const body = parse(
      z.object({ name: z.string().max(255), orgId: z.number().int().positive(), email: z.string().max(255).optional() }),
      request.body,
      "request body",
    );
    reply.code(201);
    return tenantAdmin.createTeam(tenant, body);
  });

  app.patch("/api/admin/tenants/:tenant/teams/:id", async (request) => {
    const { tenant, id } = parse(tenantParams.extend({ id: idParam }), request.params, "path parameters");
    const body = parse(
      z.object({
        name: z.string().max(255).optional(),
        email: z.string().max(255).optional(),
        status: status.optional(),
        memberIds: z.array(z.number().int().positive()).max(500).optional(),
      }),
      request.body,
      "request body",
    );
    return tenantAdmin.updateTeam(tenant, id, body);
  });

  app.get("/api/admin/tenants/:tenant/people", async (request) => {
    const { tenant } = parse(tenantParams, request.params, "path parameters");
    const { q } = parse(z.object({ q: z.string().max(100).optional() }), request.query, "query parameters");
    return { items: await tenantAdmin.people(tenant, q) };
  });
}
