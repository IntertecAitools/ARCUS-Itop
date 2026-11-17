import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import { AGENT_PROFILES } from "./editions.js";
import type { LicenceService } from "./licence.service.js";
import type { LimitMetric } from "./licence.types.js";
import { LicenceLimitError, type UsageService } from "./usage.service.js";

const GB = 1024 ** 3;
const CI_ROOT = "FunctionalCI";
const UPLOADS = new Set(["POST /api/objects/:class/:id/attachments", "POST /api/portal/requests/:id/attachments"]);
const AI_DRAFT = "POST /api/problems/:id/rca-draft";

export const isAgent = (profiles: readonly string[]) => profiles.some((p) => AGENT_PROFILES.includes(p));

/** 403 LICENCE_LIMIT, the BFF's answer to a limit reached. */
export function limitError(err: LicenceLimitError): AppError {
  return new AppError("LICENCE_LIMIT", `${err.message}.`, { details: { metric: err.metric, used: err.used, limit: err.limit } });
}

/**
 * Limits where usage grows (Build Guide, section 8), as hooks on the routes
 * that grow it, so the services that own the data stay unaware:
 *
 * - CIs: creating a record of a FunctionalCI class, a data import into one,
 *   a synchronised source run. Editing existing CIs always works.
 * - AI actions: just before the AI root-cause draft; counted when it answers.
 * - Storage: an upload by staff (requesters' uploads are counted, never refused).
 * - Sessions: every agent request marks the session active for 15 minutes.
 *
 * Agents are checked in the users service, sessions at sign-in.
 */
export function registerLimitGuard(app: FastifyInstance, licensing: LicenceService, usage: UsageService, lineage: (cls: string) => string[]): void {
  const scope = () => licensing.scopeFor(currentTenant()?.id);
  /** Each request's scope, taken while the request context is bound: onResponse may run outside it. */
  const scopeOf = new WeakMap<FastifyRequest, string | null>();

  app.addHook("onRequest", (request: FastifyRequest, _reply, done) => {
    const caller = currentCaller();
    const s = scope();
    scopeOf.set(request, s);
    if (caller?.kind === "staff" && s !== null && isAgent(caller.profiles) && request.routeOptions.url?.startsWith("/api/")) {
      usage.noteActivity(s, caller.login);
    }
    done();
  });

  const metricOf = (request: FastifyRequest): { metric: LimitMetric; amount: number } | undefined => {
    const route = `${request.method} ${request.routeOptions.url}`;
    const cls = (request.params as Record<string, unknown> | undefined)?.["class"];
    const isCi = typeof cls === "string" && lineage(cls).includes(CI_ROOT);
    if (route === AI_DRAFT) return { metric: "ai_actions", amount: 1 };
    if (isCi && (route === "POST /api/objects/:class" || route === "POST /api/admin/data-import/:class/run")) return { metric: "cis", amount: 1 };
    if (route === "POST /api/admin/data-import/sync-sources/:id/run") return { metric: "cis", amount: 1 };
    if (route === "POST /api/objects/:class/:id/attachments") {
      return { metric: "storage", amount: Number(request.headers["content-length"] ?? 0) / GB };
    }
    return undefined;
  };

  app.addHook("preHandler", (request: FastifyRequest, _reply, done) => {
    const caller = currentCaller();
    const m = caller?.kind === "staff" ? metricOf(request) : undefined;
    if (!m) return done();
    usage.assertCanAdd(scope(), m.metric, m.amount, caller?.login).then(
      () => done(),
      (err: Error) => done(err instanceof LicenceLimitError ? limitError(err) : err),
    );
  });

  // Counted once it happened.
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode >= 300) return;
    const s = scopeOf.get(request);
    if (s === null || s === undefined) return;
    const route = `${request.method} ${request.routeOptions.url}`;
    if (route === AI_DRAFT) await usage.recordUsage(s, "ai_actions", 1);
    else if (UPLOADS.has(route)) await usage.recordUsage(s, "storage", Number(request.headers["content-length"] ?? 0));
  });
}
