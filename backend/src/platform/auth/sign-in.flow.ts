import type { FastifyReply, FastifyRequest } from "fastify";

import type { Caller, SignInState } from "../../core/request-context.js";
import type { Services } from "../../services.js";
import { publicUser, type PublicUser } from "./auth.service.js";
import type { SignInAuditEntry } from "./sign-in-audit.js";

export const SESSION_COOKIE = "intertec_sid";

/** How long a sign-in may wait for its authenticator code. */
export const MFA_PENDING_MS = 10 * 60_000;
/** Wrong codes allowed per sign-in before it starts over. */
export const MFA_MAX_ATTEMPTS = 5;

export type SignInOutcome = { user: PublicUser } | { mfa: { step: "verify" | "enrol" } };

export function sessionCookie(services: Services, value: string, maxAgeSeconds: number): string {
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
 * The end of every sign-in (password, single sign-on, break-glass): either a
 * session, or a session that waits for an authenticator code and can reach
 * only /api/auth/mfa/* until it gets one.
 */
export class SignInFlow {
  constructor(private readonly services: Services) {}

  /**
   * `idpMfa`: the IdP's `amr` showed a second factor (single sign-on only).
   * The caller's `signIn.method` says how the first factor was given.
   */
  async begin(
    request: FastifyRequest,
    reply: FastifyReply,
    caller: Caller,
    idpMfa = false,
  ): Promise<SignInOutcome> {
    // The account must belong to this site's tenant (or run the platform),
    // whichever way it signed in; refused before any session exists.
    const resolution = await this.services.tenancy.resolve(request.host, caller);
    if (resolution.refused) throw resolution.refused;
    const step = await this.mfaStep(caller, idpMfa);
    if (!step) {
      return this.complete(request, reply, caller, undefined, idpMfa ? "idp" : undefined);
    }
    caller.signIn = {
      ...(caller.signIn ?? { method: "password" }),
      pending: { step, until: Date.now() + MFA_PENDING_MS, attempts: 0 },
    };
    const id = await this.services.sessions.create(caller);
    reply.header("Set-Cookie", sessionCookie(this.services, id, Math.floor(MFA_PENDING_MS / 1000)));
    return { mfa: { step } };
  }

  /** Which MFA step this sign-in still needs, if any. */
  private async mfaStep(caller: Caller, idpMfa: boolean): Promise<"verify" | "enrol" | undefined> {
    const { mfa } = this.services;
    const method = caller.signIn?.method ?? "password";
    const enrolled = (await mfa.status(caller.userId)).enrolled;
    let required: boolean;
    if (method === "sso") {
      const rule = this.services.sso?.config.mfa ?? "off";
      // SSO_MFA=idp refused the sign-in already when amr showed no MFA.
      required = caller.kind === "staff" && rule === "idp-or-totp" && !idpMfa;
    } else {
      required = mfa.requiredFor(caller) || enrolled;
    }
    if (!required) return undefined;
    return enrolled ? "verify" : "enrol";
  }

  /** Swaps a pending session (if any) for a full one, and records the sign-in. */
  async complete(
    request: FastifyRequest,
    reply: FastifyReply,
    caller: Caller,
    pendingId: string | undefined,
    mfaUsed: SignInState["mfa"],
  ): Promise<{ user: PublicUser }> {
    const method = caller.signIn?.method ?? "password";
    const full: Caller = { ...caller, signIn: { method, ...(mfaUsed ? { mfa: mfaUsed } : {}) } };
    // A new id once fully signed in: whoever saw the pending cookie does not get the session.
    if (pendingId) await this.services.sessions.delete(pendingId);
    const id = await this.services.sessions.create(full);
    const maxAge = Math.floor(this.services.config.auth.sessionMaxMs / 1000);
    reply.header("Set-Cookie", sessionCookie(this.services, id, maxAge));
    await this.audit(request, full, {
      event: method === "break-glass" ? "break_glass_sign_in" : "sign_in",
      ...(mfaUsed ? { detail: `second factor: ${mfaUsed}` } : {}),
    });
    return { user: publicUser(full) };
  }

  /** One audit entry about a known account. */
  async audit(
    request: FastifyRequest,
    caller: Caller,
    entry: Pick<SignInAuditEntry, "event"> & Partial<Pick<SignInAuditEntry, "detail">>,
  ): Promise<void> {
    await this.services.signInAudit.record({
      login: caller.login,
      userId: caller.userId,
      method: caller.signIn?.method ?? "password",
      address: request.ip,
      ...entry,
    });
  }
}
