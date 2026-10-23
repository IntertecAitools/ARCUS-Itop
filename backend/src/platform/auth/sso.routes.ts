import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors.js";
import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { readCookie } from "./auth.routes.js";
import type { SignInFlow } from "./sign-in.flow.js";

const STATE_COOKIE = "intertec_sso";
const STATE_COOKIE_PATH = "/api/auth/sso";

/**
 * Single sign-on, when OIDC_ISSUER is set. Both routes are browser
 * navigations, not API calls, so they answer with redirects:
 *
 * - `GET /api/auth/sso/start?returnTo=/path` sends the browser to the IdP.
 * - `GET /api/auth/sso/callback` is the redirect URI registered at the IdP.
 *   It lands the browser on the frontend: at `returnTo` when signed in, at
 *   `/login?next=` when an authenticator code is still needed (the sign-in page
 *   learns which step from /api/auth/me), or at `/login?sso_error=` with
 *   the reason when refused.
 */
export function registerSsoRoutes(app: FastifyInstance, services: Services, flow: SignInFlow): void {
  const { sso, auth, signInAudit, config } = services;
  if (!sso) return;

  /** The state cookie only goes back to the SSO routes, and lives as long as the round trip. */
  function stateCookie(value: string, maxAgeSeconds: number): string {
    return [
      `${STATE_COOKIE}=${value}`,
      `Path=${STATE_COOKIE_PATH}`,
      "HttpOnly",
      // Lax: the IdP's redirect back is a top-level GET navigation, which carries it.
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
      ...(config.auth.cookieSecure ? ["Secure"] : []),
    ].join("; ");
  }

  app.get("/api/auth/sso/start", async (request, reply) => {
    const query = parse(z.object({ returnTo: z.string().max(500).optional() }), request.query, "query parameters");
    try {
      const { url, cookie } = await sso.start(query.returnTo);
      reply.header("Set-Cookie", stateCookie(cookie, 600));
      return reply.redirect(url, 302);
    } catch (error) {
      request.log.error({ err: error }, "Single sign-on could not start");
      return reply.redirect(sso.landing("/", "The sign-in provider cannot be reached. Try again later."), 302);
    }
  });

  app.get("/api/auth/sso/callback", async (request, reply) => {
    const rawQuery = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
    const clearState = stateCookie("", 0);
    let email = "";
    try {
      const { identity, returnTo } = await sso.finish(rawQuery, readCookie(request, STATE_COOKIE));
      email = identity.email;
      const caller = await auth.signInWithSso(identity);
      // SSO_MFA=idp: staff must have given the IdP a second factor (its `amr`).
      if (sso.config.mfa === "idp" && caller.kind === "staff" && !identity.mfa) {
        throw new AppError("forbidden", "Your sign-in did not use multi-factor authentication. Sign in again with it.");
      }
      const outcome = await flow.begin(request, reply, caller, identity.mfa);
      reply.header("Set-Cookie", clearState); // added next to the session cookie
      return reply.redirect("mfa" in outcome ? sso.landing(`/login?next=${encodeURIComponent(returnTo)}`) : sso.landing(returnTo), 302);
    } catch (error) {
      const message =
        error instanceof AppError && error.status < 500
          ? error.message
          : "Single sign-on failed. Try again, or ask an administrator.";
      request.log.warn({ err: error }, "Single sign-on refused");
      await signInAudit
        .record({ event: "sign_in_refused", login: email || "(unknown)", method: "sso", address: request.ip, detail: message })
        .catch((auditError: unknown) => request.log.error({ err: auditError }, "Could not write the sign-in audit log"));
      reply.header("Set-Cookie", clearState);
      return reply.redirect(sso.landing("/", message), 302);
    }
  });
}
