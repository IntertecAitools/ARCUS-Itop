import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors.js";
import { currentCaller, type Caller } from "../../core/request-context.js";
import { idParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { pendingSignIn } from "./auth.routes.js";
import { MFA_MAX_ATTEMPTS, SignInFlow, sessionCookie } from "./sign-in.flow.js";

const code = z.string().max(20);

/**
 * The authenticator step of sign-in, and managing one's own enrolment.
 *
 * - `POST /api/auth/mfa/verify` `{ code }` or `{ recoveryCode }`
 * - `GET /api/auth/mfa/enrol` (a new secret and its otpauth:// link),
 *   `POST /api/auth/mfa/enrol` `{ code }` (answers the recovery codes, once)
 * - `GET /api/auth/mfa`, `POST /api/auth/mfa/recovery-codes` `{ code }`
 * - administrators: `DELETE /api/admin/users/:id/mfa` (lost phone),
 *   `GET /api/admin/sign-in-audit`
 */
export function registerMfaRoutes(app: FastifyInstance, services: Services, flow: SignInFlow): void {
  const { mfa, sessions, auth, signInAudit } = services;

  /** The sign-in waiting for its code, at the step this route serves. */
  function pending(request: FastifyRequest, step: "verify" | "enrol"): { id: string; caller: Caller } {
    const found = pendingSignIn(request);
    if (!found) throw new AppError("unauthorized", "Sign in again: this sign-in has expired.");
    if (found.caller.signIn?.pending?.step !== step) {
      throw new AppError("conflict", step === "enrol" ? "This account is enrolled already." : "Set up your authenticator first.");
    }
    return found;
  }

  /** Counts a wrong code; past the limit the sign-in starts over. */
  async function wrongCode(request: FastifyRequest, reply: FastifyReply, id: string, caller: Caller): Promise<never> {
    auth.recordWrongCode(caller.login, request.ip);
    await flow.audit(request, caller, { event: "mfa_failed" });
    const state = caller.signIn!.pending!;
    state.attempts += 1;
    if (state.attempts >= MFA_MAX_ATTEMPTS) {
      await sessions.delete(id);
      reply.header("Set-Cookie", sessionCookie(services, "", 0));
      throw new AppError("unauthorized", "Too many wrong codes. Sign in again.");
    }
    await sessions.update(id, caller);
    throw new AppError("unauthorized", "That code is not right. Check your authenticator app and try again.", {
      details: { attemptsLeft: MFA_MAX_ATTEMPTS - state.attempts },
    });
  }

  app.post("/api/auth/mfa/verify", async (request, reply) => {
    const { id, caller } = pending(request, "verify");
    auth.assertCodeNotThrottled(caller.login, request.ip);
    const body = parse(
      z.object({ code: code.optional(), recoveryCode: code.optional() }),
      request.body,
      "request body",
    );
    const used = await mfa.verify(caller, body);
    if (!used) return wrongCode(request, reply, id, caller);
    if (used === "recovery") {
      const left = await mfa.status(caller.userId);
      await flow.audit(request, caller, { event: "recovery_code_used", detail: `${left.recoveryCodesLeft} left` });
    }
    return flow.complete(request, reply, caller, id, used);
  });

  app.get("/api/auth/mfa/enrol", async (request) => {
    const { id, caller } = pending(request, "enrol");
    const state = caller.signIn!.pending!;
    // The same secret until it is confirmed, so reloading the page does not
    // invalidate what the app has already scanned.
    if (!state.secret) {
      state.secret = mfa.newSecret();
      await sessions.update(id, caller);
    }
    return {
      secret: state.secret,
      otpauthUrl: mfa.otpauthUrl(caller, state.secret),
      account: caller.email || caller.login,
    };
  });

  app.post("/api/auth/mfa/enrol", async (request, reply) => {
    const { id, caller } = pending(request, "enrol");
    auth.assertCodeNotThrottled(caller.login, request.ip);
    const body = parse(z.object({ code }), request.body, "request body");
    const secret = caller.signIn!.pending!.secret;
    if (!secret) throw new AppError("conflict", "Open the set-up step first.");
    const recoveryCodes = await mfa.confirmEnrolment(caller, secret, body.code);
    if (!recoveryCodes) return wrongCode(request, reply, id, caller);
    await flow.audit(request, caller, { event: "mfa_enrolled" });
    const result = await flow.complete(request, reply, caller, id, "totp");
    return { ...result, recoveryCodes };
  });

  /** The signed-in user's own enrolment. */
  app.get("/api/auth/mfa", async () => {
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    return {
      ...(await mfa.status(caller.userId)),
      required: mfa.requiredFor(caller),
      signedInWith: caller.signIn?.method ?? "password",
      secondFactor: caller.signIn?.mfa ?? null,
    };
  });

  app.post("/api/auth/mfa/recovery-codes", async (request) => {
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Sign in to continue.");
    auth.assertCodeNotThrottled(caller.login, request.ip);
    const body = parse(z.object({ code }), request.body, "request body");
    const recoveryCodes = await mfa.renewRecoveryCodes(caller, body.code);
    if (!recoveryCodes) {
      auth.recordWrongCode(caller.login, request.ip);
      throw new AppError("bad_request", "That code is not right. Check your authenticator app and try again.");
    }
    await flow.audit(request, caller, { event: "recovery_codes_renewed" });
    return { recoveryCodes };
  });

  /** Removes a user's enrolment: they set up a new authenticator at their next sign-in. */
  app.delete("/api/admin/users/:id/mfa", async (request, reply) => {
    const admin = currentCaller()!;
    const { id } = parse(z.object({ id: idParam }), request.params, "path parameters");
    const had = await mfa.reset(id);
    if (!had) throw new AppError("not_found", "This account has no authenticator set up.");
    await signInAudit.record({
      event: "mfa_reset",
      login: admin.login,
      userId: id,
      method: "admin",
      address: request.ip,
      detail: `authenticator of user ${id} removed by ${admin.login}`,
    });
    // Sessions that passed MFA with the old authenticator end too.
    await sessions.deleteForUser(id);
    reply.code(204);
    return null;
  });

  app.get("/api/admin/sign-in-audit", async (request) => {
    const query = parse(
      z.object({
        limit: intParam(1, 500, 100),
        before: z.coerce.number().int().positive().optional(),
        login: z.string().max(255).optional(),
      }),
      request.query,
      "query parameters",
    );
    return {
      entries: await signInAudit.list({
        limit: query.limit,
        ...(query.before ? { before: query.before } : {}),
        ...(query.login ? { login: query.login } : {}),
      }),
    };
  });
}
