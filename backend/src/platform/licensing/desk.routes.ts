import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import { validateTenants, type Tenant, type TenantStore } from "../tenancy/tenant.store.js";
import { DEPLOYMENTS, EDITIONS, type Edition } from "./editions.js";
import { issueAndRegister, reissueRequest, renewals } from "./issuer/desk.js";
import { buildLicenceFields, IssueError, type IssueRequest } from "./issuer/issue.js";
import type { RegisterEntry, RegisterStore } from "./issuer/register.store.js";
import { LicenceError, type LicenceService } from "./licence.service.js";
import type { IssueLicenceResult, LicenceType, LicencesOverview, RegisterRow } from "./licence.types.js";
import { LICENCE_TYPES, parseBinding, type Signer } from "./sdk/index.js";

/** The licence desk on the platform: the register, a signer when this server has one, the tenants. */
export interface DeskDeps {
  register: RegisterStore;
  signer?: Signer;
  tenants: TenantStore;
  platformLogins: string[];
}

const count = z.number().int().min(0).max(1_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IssueBody = z.object({
  customer: z.string().trim().min(1).max(200),
  orderRef: z.string().trim().max(64).default(""),
  type: z.enum(LICENCE_TYPES),
  termYears: z.number().int().min(1).max(10).optional(),
  edition: z.enum(EDITIONS),
  deployment: z.enum(DEPLOYMENTS),
  binding: z.string().trim().min(3).max(200),
  agents: z.number().int().min(1).max(1_000_000),
  concurrentSeats: count.optional(),
  ciPacks: count.optional(),
  aiPacks: count.optional(),
  storagePacks: count.optional(),
  validFrom: day.optional(),
  reason: z.string().trim().max(500).optional(),
  newTenant: z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "A tenant id is 2 to 40 lower-case letters, digits and dashes."),
      name: z.string().trim().min(1).max(200),
      domains: z.array(z.string().trim().min(1).max(253)).max(20),
      orgIds: z.array(z.number().int().positive()).min(1).max(200),
    })
    .optional(),
});
const ReissueBody = z.object({
  reason: z.string().trim().min(1).max(500),
  edition: z.enum(EDITIONS).optional(),
  type: z.enum(LICENCE_TYPES).optional(),
  agents: z.number().int().min(1).max(1_000_000).optional(),
  concurrentSeats: count.optional(),
  ciPacks: count.optional(),
  aiPacks: count.optional(),
  storagePacks: count.optional(),
  binding: z.string().trim().min(3).max(200).optional(),
  termYears: z.number().int().min(1).max(10).optional(),
  validFrom: day.optional(),
  expiresAt: day.optional(),
});
const RevokeBody = z.object({ reason: z.string().trim().min(1).max(500) });
const IdParam = z.object({ id: z.string().regex(/^ARC-\d{4}-\d{6}$/) });

export function toRow(e: RegisterEntry): RegisterRow {
  return {
    licenceId: e.licenceId,
    customer: e.customer,
    orderRef: e.orderRef,
    binding: e.binding,
    edition: e.edition as Edition,
    licenceType: e.licenceType as LicenceType,
    validFrom: e.validFrom,
    expiresAt: e.expiresAt,
    issuedBy: e.issuedBy,
    issuedAt: e.issuedAt,
    reason: e.reason,
    replaces: e.replaces,
    replacedBy: e.replacedBy,
    revokedAt: e.revokedAt,
    revokedBy: e.revokedBy,
    revokeReason: e.revokeReason,
    status: e.revokedAt ? "revoked" : e.replacedBy ? "replaced" : "current",
  };
}

function toRequest(b: z.infer<typeof IssueBody>): IssueRequest {
  return {
    customer: b.customer,
    orderRef: b.orderRef,
    type: b.type,
    ...(b.termYears !== undefined ? { termYears: b.termYears } : {}),
    order: {
      edition: b.edition,
      deployment: b.deployment,
      agents: b.agents,
      concurrentSeats: b.concurrentSeats ?? 0,
      ciPacks: b.ciPacks ?? 0,
      aiPacks: b.aiPacks ?? 0,
      storagePacks: b.storagePacks ?? 0,
    },
    binding: b.binding,
    ...(b.validFrom ? { validFrom: b.validFrom } : {}),
  };
}

/**
 * The Licences page's API (Build Guide, section 5 step C, and section 12):
 * the licence register, issuing (for a new SaaS customer, creating its
 * tenant in the same step), re-issuing, revoking, the renewals due.
 * Platform operators on the platform's own address only. The same code as
 * the CLI (issuer/desk.ts).
 */
export function registerDeskRoutes(app: FastifyInstance, licensing: LicenceService, deps: DeskDeps): void {
  const operators = new Set(deps.platformLogins.map((l) => l.toLowerCase()));
  const assertOperator = () => {
    const caller = currentCaller();
    if (!caller || caller.kind !== "staff" || !operators.has(caller.login.toLowerCase()) || currentTenant()) {
      throw new AppError("forbidden", "The licence desk is for platform operators, on the platform's own address.");
    }
    return caller;
  };
  const signer = () => {
    if (!deps.signer) throw new AppError("conflict", "This server cannot sign licences (LICENCE_SIGNER is not set). Issue the licence with the CLI.");
    return deps.signer;
  };
  const asBadRequest = (err: unknown): never => {
    if (err instanceof IssueError || err instanceof LicenceError) throw new AppError("bad_request", err.message);
    throw err;
  };

  /** SaaS: a tenant-bound licence is installed for its tenant straight away. */
  const installForTenant = async (binding: string, text: string, by: string): Promise<boolean> => {
    const b = parseBinding(binding);
    if (b?.kind !== "tenant" || !licensing.settings.tenancy) return false;
    await licensing.install(b.tenant, text, by, true).catch(asBadRequest);
    return true;
  };

  app.get("/api/platform/licences", async (request): Promise<LicencesOverview> => {
    assertOperator();
    const q = parse(z.object({ customer: z.string().max(200).optional() }), request.query, "query");
    const entries = await deps.register.list(q.customer ? { customer: q.customer } : undefined);
    const due = renewals(entries);
    return {
      canIssue: !!deps.signer,
      licences: entries.map(toRow).reverse(),
      renewals: { within30: due.within30.map(toRow), within60: due.within60.map(toRow), within90: due.within90.map(toRow) },
    };
  });

  app.get("/api/platform/licences/:id/file", async (request, reply) => {
    assertOperator();
    const { id } = parse(IdParam, request.params, "path parameters");
    const entry = await deps.register.get(id);
    if (!entry) throw new AppError("not_found", `No licence ${id} in the register.`);
    reply.header("Content-Type", "text/plain; charset=utf-8").header("Content-Disposition", `attachment; filename="${id}.lic"`);
    return entry.text;
  });

  app.post("/api/platform/licences", async (request, reply): Promise<IssueLicenceResult> => {
    const caller = assertOperator();
    const body = parse(IssueBody, request.body, "request body");
    let tenant: Tenant | undefined;
    if (body.newTenant) {
      if (!licensing.settings.tenancy) throw new AppError("bad_request", "Tenants exist only with TENANCY=on.");
      const t = body.newTenant;
      if (body.binding !== `tenant:${t.id}` || body.deployment !== "saas") {
        throw new AppError("bad_request", `A new customer's licence is a SaaS licence bound to tenant:${t.id}.`);
      }
      const all = await deps.tenants.list();
      if (all.some((x) => x.id === t.id)) throw new AppError("conflict", `Tenant ${t.id} already exists.`);
      tenant = { id: t.id, name: t.name, status: "active", domains: t.domains.map((d) => d.toLowerCase()), orgIds: t.orgIds };
      try {
        validateTenants([...all, tenant]);
      } catch (err) {
        throw new AppError("bad_request", (err as Error).message);
      }
    }
    // One step for the operator, and all or nothing: the order is checked
    // first (nothing is saved for a refused one), then the tenant is saved,
    // then the licence is signed and registered. If signing fails, the new
    // tenant is taken away again; if saving the tenant fails, no licence
    // exists yet.
    const req = toRequest(body);
    const sign = signer();
    try {
      buildLicenceFields(req, "ARC-0000-000000", new Date());
    } catch (err) {
      asBadRequest(err);
    }
    if (tenant) await deps.tenants.save(tenant);
    let issued: Awaited<ReturnType<typeof issueAndRegister>>;
    try {
      issued = await issueAndRegister(deps.register, sign, req, { by: caller.login, reason: body.reason || "new order" });
    } catch (err) {
      if (tenant) await deps.tenants.remove(tenant.id).catch(() => undefined);
      return asBadRequest(err);
    }
    const installed = await installForTenant(issued.entry.binding, issued.text, caller.login);
    reply.code(201);
    return { licence: toRow(issued.entry), text: issued.text, installed, tenantCreated: !!tenant };
  });

  app.post("/api/platform/licences/:id/reissue", async (request, reply): Promise<IssueLicenceResult> => {
    const caller = assertOperator();
    const { id } = parse(IdParam, request.params, "path parameters");
    const { reason, ...changes } = parse(ReissueBody, request.body, "request body");
    const old = await deps.register.get(id);
    if (!old) throw new AppError("not_found", `No licence ${id} in the register.`);
    if (old.revokedAt) throw new AppError("conflict", `Licence ${id} was revoked; issue a new one instead.`);
    const req = reissueRequest(old.request, old.expiresAt, changes);
    const issued = await issueAndRegister(deps.register, signer(), req, { by: caller.login, reason, replaces: id }).catch(asBadRequest);
    const installed = await installForTenant(issued.entry.binding, issued.text, caller.login);
    reply.code(201);
    return { licence: toRow(issued.entry), text: issued.text, installed, tenantCreated: false };
  });

  app.post("/api/platform/licences/:id/revoke", async (request) => {
    const caller = assertOperator();
    const { id } = parse(IdParam, request.params, "path parameters");
    const { reason } = parse(RevokeBody, request.body, "request body");
    const entry = await deps.register.get(id);
    if (!entry) throw new AppError("not_found", `No licence ${id} in the register.`);
    if (entry.revokedAt) throw new AppError("conflict", `Licence ${id} is already revoked.`);
    await deps.register.revoke(id, caller.login, reason, new Date().toISOString());
    // SaaS: applies now on this instance, and at the next minute's refresh on the others.
    await licensing.refresh();
    return toRow((await deps.register.get(id))!);
  });
}
