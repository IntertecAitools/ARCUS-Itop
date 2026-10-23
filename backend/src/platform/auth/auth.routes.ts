import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors.js";
import { currentCaller, enterRequestContext, type Caller } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { publicUser } from "./auth.service.js";
import { registerMfaRoutes } from "./mfa.routes.js";
import { SESSION_COOKIE, SignInFlow, sessionCookie } from "./sign-in.flow.js";
import { registerSsoRoutes } from "./sso.routes.js";

export { SESSION_COOKIE };

/** Paths that answer without a session. The MFA step checks its own (pending) session. */
const PUBLIC_PATHS = new Set([
  "/health",
  "/health/upstream",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/options",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/sso/start",
  "/api/auth/sso/callback",
  "/api/auth/mfa/verify",
  "/api/auth/mfa/enrol",
]);

/**
 * Sessions still waiting for an authenticator code, by request. They are not
 * bound as the caller (nothing may run as them yet); only the MFA routes and
 * /api/auth/me look them up here.
 */
const pendingByRequest = new WeakMap<FastifyRequest, { id: string; caller: Caller }>();

export function pendingSignIn(request: FastifyRequest): { id: string; caller: Caller } | undefined {
  return pendingByRequest.get(request);
}

/** Break-glass sessions, by request, so each of their requests can be audited when it ends. */
const breakGlassByRequest = new WeakMap<FastifyRequest, Caller>();

/** What an end-user (portal) session may reach. Everything else is staff-only. */
const PORTAL_PREFIXES = ["/api/auth/", "/api/portal/", "/api/me/"];

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Sign-in for every kind of user, and the guard in front of the whole API.
 *
 * The guard resolves the session cookie to a caller and binds it to the
 * request, so the iTop client calls iTop as that user. It refuses requests
 * without a session, keeps end users to the self-service API, keeps the
 * admin API to administrators, and refuses state-changing requests from an
 * origin outside CORS_ORIGINS.
 */
export function registerAuth(app: FastifyInstance, services: Services): void {
  const { sessions, auth, config, passwordReset, signInAudit } = services;
  const flow = new SignInFlow(services);

  app.addHook("onRequest", (request: FastifyRequest, _reply, done) => {
    // Callback style on purpose. The session lookup is async (it may read a
    // database), and AsyncLocalStorage's enterWith only reaches the handler
    // when the hook hands over from the same async context that bound the
    // caller -- an async hook resumes in another one and the handler would
    // see nobody signed in.
    const id = readCookie(request, SESSION_COOKIE);
    sessions.get(id).then(
      (session) => {
        try {
          let caller = session;
          const pending = session?.signIn?.pending;
          if (session && pending) {
            // Not signed in yet: remembered for the MFA routes, bound as nobody.
            if (pending.until > Date.now()) pendingByRequest.set(request, { id: id!, caller: session });
            caller = undefined;
          }
          if (caller?.signIn?.method === "break-glass") breakGlassByRequest.set(request, caller);
          guard(request, caller);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
      (error: Error) => done(error),
    );
  });

  function guard(request: FastifyRequest, caller: Caller | undefined): void {
    enterRequestContext(caller);
    if (!config.auth.required || request.method === "OPTIONS") return;

    if (!["GET", "HEAD"].includes(request.method) && !allowedOrigin(request)) {
      throw new AppError("forbidden", "This request did not come from an allowed origin.");
    }

    // Decide on the route that will answer, as registered (/api/admin/users/:id),
    // never on the raw URL: the router decodes percent-escapes, so
    // "/%61pi/%61dmin/users" reaches /api/admin/users while a prefix check on
    // the raw text sees neither "/api/" nor "/api/admin/".
    const path = request.routeOptions.url;
    // No route: the not-found handler answers, and it reveals nothing.
    if (path === undefined) return;

    if (PUBLIC_PATHS.has(path) || !path.startsWith("/api/")) return;
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    if (caller.kind === "portal" && !PORTAL_PREFIXES.some((p) => path.startsWith(p))) {
      throw new AppError("forbidden", "This is not available to end-user accounts.");
    }
    if (path.startsWith("/api/admin/") && !caller.isAdmin) {
      throw new AppError("forbidden", "Only administrators can do this.");
    }
  }

  // Every request a break-glass session makes is written to the sign-in audit
  // log, with its outcome: the account exists for emergencies only.
  app.addHook("onResponse", async (request, reply) => {
    const caller = breakGlassByRequest.get(request);
    if (!caller || !request.routeOptions.url?.startsWith("/api/")) return;
    await signInAudit
      .record({
        event: "break_glass_request",
        login: caller.login,
        userId: caller.userId,
        method: "break-glass",
        address: request.ip,
        // The path as asked (no query string), so the log names the record touched.
        detail: `${request.method} ${request.url.split("?")[0]} -> ${reply.statusCode}`,
      })
      .catch((error: unknown) => request.log.error({ err: error }, "Could not write the sign-in audit log"));
  });

  /**
   * A write's Origin, when the browser sent one, must be allow-listed. With
   * CORS_ORIGINS=* (no list) it must at least be this server's own origin:
   * no other site can use the API with credentials then anyway, so this only
   * shuts out a cross-origin form or fetch riding on a same-site cookie.
   */
  function allowedOrigin(request: FastifyRequest): boolean {
    const origin = request.headers.origin?.replace(/\/+$/, "");
    if (!origin) return true;
    if (Array.isArray(config.corsOrigins)) return config.corsOrigins.includes(origin);
    try {
      return new URL(origin).host === request.host;
    } catch {
      return false;
    }
  }

  app.post("/api/auth/login", async (request, reply: FastifyReply) => {
    const body = parse(
      z.object({ login: z.string().max(255), password: z.string().max(1_024) }),
      request.body,
      "request body",
    );
    // End users are served by the self-service API (/api/portal), which the
    // guard keeps them to; staff get the whole API, as themselves.
    let caller: Caller;
    try {
      caller = await auth.signIn(body.login, body.password, request.ip);
    } catch (error) {
      if (error instanceof AppError && error.code !== "rate_limited" && body.login.trim()) {
        const breakGlass = auth.isBreakGlass(body.login.trim());
        await signInAudit.record({
          event: breakGlass ? "break_glass_refused" : "sign_in_refused",
          login: body.login.trim().slice(0, 255),
          method: breakGlass ? "break-glass" : "password",
          address: request.ip,
          detail: error.message,
        });
      }
      throw error;
    }
    // Staff (MFA_REQUIRED), break-glass accounts and anyone enrolled answer
    // { mfa: { step } } here and finish at /api/auth/mfa/*.
    return flow.begin(request, reply, caller);
  });

  /** What the sign-in page may offer, before anyone is signed in. */
  app.get("/api/auth/options", async () => ({
    passwordReset: passwordReset.enabled,
    sso: services.sso ? { label: services.sso.config.label } : null,
    passwordSignIn: config.auth.signIn?.passwordSignIn ?? "all",
  }));

  /**
   * Sends a reset link to the account behind a login or email address. The
   * answer is the same whether or not one exists, and the email goes out
   * after it, so neither the wording nor the timing tells them apart.
   */
  app.post("/api/auth/forgot-password", async (request, reply) => {
    const body = parse(
      z.object({ identifier: z.string().max(255) }),
      request.body,
      "request body",
    );
    const work = passwordReset.request(body.identifier, request.ip);
    setImmediate(() => {
      work().catch((error: unknown) =>
        request.log.error({ err: error }, "Could not send a password reset email"),
      );
    });
    reply.code(202);
    return {
      ok: true,
      message:
        "If an account matches, we've sent a link to its email address. " +
        "It works once and expires soon.",
    };
  });

  app.post("/api/auth/reset-password", async (request) => {
    const body = parse(
      z.object({ token: z.string().max(200), password: z.string().max(1_024) }),
      request.body,
      "request body",
    );
    await passwordReset.reset(body.token, body.password);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await sessions.delete(readCookie(request, SESSION_COOKIE));
    reply.header("Set-Cookie", sessionCookie(services, "", 0));
    reply.code(204);
    return null;
  });

  /**
   * Who is signed in; 401 when nobody is, which is how the app knows to show
   * sign-in. A sign-in waiting for its authenticator code is a 401 too, with
   * `details.mfa` saying which step (after single sign-on, the app lands here).
   */
  app.get("/api/auth/me", async (request) => {
    const caller = currentCaller();
    if (!caller) {
      const pending = pendingSignIn(request)?.caller.signIn?.pending;
      throw new AppError("unauthorized", "Not signed in.", pending ? { details: { mfa: { step: pending.step } } } : {});
    }
    return { user: publicUser(caller) };
  });

  app.post("/api/auth/password", async (request) => {
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    const body = parse(
      z.object({ current: z.string().max(1_024), next: z.string().max(1_024) }),
      request.body,
      "request body",
    );
    await auth.changeOwnPassword(caller, body.current, body.next);
    // The session keeps calling iTop as this user, so it needs the new password.
    const id = readCookie(request, SESSION_COOKIE);
    if (id && caller.credentials && "password" in caller.credentials) {
      await sessions.update(id, { ...caller, credentials: { user: caller.login, password: body.next } });
    }
    return { ok: true };
  });

  registerMfaRoutes(app, services, flow);
  registerSsoRoutes(app, services, flow);
}
