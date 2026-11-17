import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { LicenceService } from "./licence.service.js";

/**
 * Changes an agent may still make while the licence is read-only: signing in
 * and out, the licence itself (so a new key can be installed), their own
 * preferences and drafts, the requester portal, and POSTs that only read.
 * Every GET (lists, records, exports) always passes.
 */
const ALWAYS_ALLOWED_PREFIXES = ["/api/auth/", "/api/licence", "/api/me/", "/api/portal/"];
const READS_BY_POST = new Set([
  "/api/queries/run",
  "/api/objects/:class/bulk/delete-plan",
  "/api/ticket-handling/duplicates/suggest",
  "/api/admin/assignment-rules/test",
  "/api/problems/:id/rca-draft",
]);

/**
 * Under `/api/me/` but changing records, not the user's own things: an
 * approver's decision updates the approval and the ticket behind it.
 */
const RECORD_CHANGES_UNDER_ME = ["/api/me/approvals/"];

export function isWriteExempt(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (!path.startsWith("/api/")) return true;
  if (RECORD_CHANGES_UNDER_ME.some((p) => path.startsWith(p))) return false;
  return ALWAYS_ALLOWED_PREFIXES.some((p) => path.startsWith(p)) || READS_BY_POST.has(path);
}

/**
 * Read-only mode (Build Guide, section 9): one hook before every route. When
 * the tenant's (or installation's) licence is read-only or not valid, any
 * change by an agent is refused with 403 LICENCE_READ_ONLY. With
 * LICENSING=warn nothing is refused: it is recorded as "would have refused",
 * once a day per kind of request. Requesters are never affected.
 *
 * Registered after the sign-in guard, so the caller and the tenant are bound.
 */
export function registerLicenceGuard(app: FastifyInstance, licensing: LicenceService): void {
  app.addHook("onRequest", (request: FastifyRequest, _reply, done) => {
    const path = request.routeOptions.url;
    const caller = currentCaller();
    if (path === undefined || !caller || caller.kind !== "staff" || isWriteExempt(request.method, path)) {
      done();
      return;
    }
    const scope = licensing.scopeFor(currentTenant()?.id);
    if (scope === null) {
      done();
      return;
    }
    licensing.statusOf(scope).then(
      (status) => {
        if (!licensing.isBlocking(status)) return done();
        const what = `${request.method} ${path}`;
        if (licensing.mode === "warn") {
          void licensing.recordOnce(scope, "would_refuse", `read_only:${what}`, `Would have refused ${what} for ${caller.login}: licence ${status.state}.`, caller.login);
          return done();
        }
        void licensing.recordOnce(scope, "refused", `read_only:${what}`, `Refused ${what} for ${caller.login}: licence ${status.state}.`, caller.login);
        done(
          new AppError(
            "LICENCE_READ_ONLY",
            status.state === "evaluation_mode"
              ? "There is no valid licence, so changes are paused. Data can still be read and exported. An administrator must install a valid licence."
              : "The licence has ended, so changes are paused. Data can still be read and exported. An administrator can install a new licence.",
            { details: { state: status.state } },
          ),
        );
      },
      (err: Error) => done(err),
    );
  });
}
