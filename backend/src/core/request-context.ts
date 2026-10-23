import { AsyncLocalStorage } from "node:async_hooks";

/** Who a request is for, resolved from the session cookie. */
export interface Caller {
  /** iTop User id. */
  userId: number;
  login: string;
  /** The Person behind the account; 0 when none is linked. */
  contactId: number;
  name: string;
  email: string;
  /**
   * `staff` work in the agent screens and call iTop as themselves.
   * `portal` are end users; iTop's REST API refuses them (webservices/rest.php
   * logs in for the back office only), so they use the self-service API.
   */
  kind: "staff" | "portal";
  profiles: string[];
  isAdmin: boolean;
  /** Organisations the account is limited to; empty means all. */
  allowedOrgIds: number[];
  /** The organisation of the linked Person, when there is one. */
  orgId: number;
  /**
   * The user's own iTop credentials, for staff: every iTop call on their
   * behalf is made with them, so iTop applies their profiles and records
   * their name in history. Held in server memory only.
   *
   * After single sign-on there is no password: `external` calls carry the
   * login in ITOP_EXTERNAL_AUTH_HEADER, which iTop's "external" login trusts
   * (a UserExternal account).
   */
  credentials?: ItopCredentials;
  /** How this session signed in, and whether it is still waiting for MFA. */
  signIn?: SignInState;
}

export type ItopCredentials = { user: string; password: string } | { user: string; external: true };

export interface SignInState {
  method: "password" | "sso" | "break-glass";
  /** The second factor given, when one was: our authenticator code, a recovery code, or the IdP's (`amr`). */
  mfa?: "totp" | "recovery" | "idp";
  /**
   * Set while the password (or IdP) is checked but the authenticator code is
   * not: the session reaches only /api/auth/mfa/* until `until`.
   */
  pending?: {
    step: "verify" | "enrol";
    until: number;
    /** Wrong codes so far; the sign-in starts over after a few. */
    attempts: number;
    /** The secret being enrolled, until the first code confirms it. */
    secret?: string;
  };
}

interface RequestContext {
  caller?: Caller;
  /** Set by runAsServiceAccount: iTop calls use the BFF's own account. */
  asService?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Binds a caller to the rest of the current request. Called from the auth
 * hook; everything the request does after it, however deep, sees the caller.
 */
export function enterRequestContext(caller: Caller | undefined): void {
  storage.enterWith({ ...(caller ? { caller } : {}) });
}

/** Runs `fn` with `caller` bound; for code outside a request (tests, jobs). */
export function runAs<T>(caller: Caller | undefined, fn: () => T): T {
  return storage.run({ ...(caller ? { caller } : {}) }, fn);
}

export function currentCaller(): Caller | undefined {
  return storage.getStore()?.caller;
}

/**
 * Runs `fn` with every iTop call in it made as the service account, the
 * caller still bound. For code that is itself the access control and reuses
 * shared services, like the self-service portal's attachments: iTop refuses
 * end users, so their calls cannot run as them.
 */
export function runAsServiceAccount<T>(fn: () => T): T {
  return storage.run({ ...storage.getStore(), asService: true }, fn);
}

export function serviceAccountBound(): boolean {
  return storage.getStore()?.asService === true;
}
