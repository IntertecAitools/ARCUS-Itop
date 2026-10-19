import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors.js";
import { currentCaller, enterRequestContext, type Caller } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { publicUser } from "./auth.service.js";

export const SESSION_COOKIE = "intertec_sid";

/** Paths that answer without a session. */
const PUBLIC_PATHS = new Set(["/health", "/health/upstream", "/api/auth/login", "/api/auth/me", "/api/auth/logout"]);

/** What an end-user (portal) session may reach. Everything else is staff-only. */
const PORTAL_PREFIXES = ["/api/auth/", "/api/portal/"];

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function sessionCookie(services: Services, value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    // Lax: sent on the app's own requests and top-level navigations, never on
    // a cross-site POST -- the CSRF half of the cookie's job.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(services.config.auth.cookieSecure ? ["Secure"] : []),
  ].join("; ");
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
  const { sessions, auth, config } = services;

  app.addHook("onRequest", (request: FastifyRequest, _reply, done) => {
    // Callback style on purpose. The session lookup is async (it may read a
    // database), and AsyncLocalStorage's enterWith only reaches the handler
    // when the hook hands over from the same async context that bound the
    // caller -- an async hook resumes in another one and the handler would
    // see nobody signed in.
    sessions.get(readCookie(request, SESSION_COOKIE)).then(
      (caller) => {
        try {
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

    const path = request.url.split("?")[0] ?? "";

    if (!["GET", "HEAD"].includes(request.method) && Array.isArray(config.corsOrigins)) {
      const origin = request.headers.origin?.replace(/\/+$/, "");
      if (origin && !config.corsOrigins.includes(origin)) {
        throw new AppError("forbidden", "This request did not come from an allowed origin.");
      }
    }

    if (PUBLIC_PATHS.has(path) || !path.startsWith("/api/")) return;
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    if (caller.kind === "portal" && !PORTAL_PREFIXES.some((p) => path.startsWith(p))) {
      throw new AppError("forbidden", "This is not available to end-user accounts.");
    }
    if (path.startsWith("/api/admin/") && !caller.isAdmin) {
      throw new AppError("forbidden", "Only administrators can do this.");
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
    const caller = await auth.signIn(body.login, body.password);
    const id = await sessions.create(caller);
    reply.header("Set-Cookie", sessionCookie(services, id, Math.floor(config.auth.sessionMaxMs / 1000)));
    return { user: publicUser(caller) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await sessions.delete(readCookie(request, SESSION_COOKIE));
    reply.header("Set-Cookie", sessionCookie(services, "", 0));
    reply.code(204);
    return null;
  });

  /** Who is signed in; 401 when nobody is, which is how the app knows to show sign-in. */
  app.get("/api/auth/me", async () => {
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Not signed in.");
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
    if (id && caller.credentials) {
      await sessions.update(id, { ...caller, credentials: { user: caller.login, password: body.next } });
    }
    return { ok: true };
  });
}
