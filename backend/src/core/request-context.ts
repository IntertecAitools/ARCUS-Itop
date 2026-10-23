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
   */
  credentials?: { user: string; password: string };
}

/**
 * The customer a request is for, when the platform serves several
 * (TENANCY=on): every iTop read and write is limited to these organisations
 * (platform/tenancy). Absent means unscoped: tenancy is off, or a platform
 * operator on the platform's own address.
 */
export interface TenantScope {
  id: string;
  name: string;
  orgIds: number[];
}

interface RequestContext {
  caller?: Caller;
  /** Set by runAsServiceAccount: iTop calls use the BFF's own account. */
  asService?: boolean;
  tenant?: TenantScope;
  /** Set by runUnscoped: the tenant guard lets these calls through as they are. */
  unscoped?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Binds a caller to the rest of the current request. Called from the auth
 * hook; everything the request does after it, however deep, sees the caller.
 */
export function enterRequestContext(caller: Caller | undefined, tenant?: TenantScope): void {
  storage.enterWith({ ...(caller ? { caller } : {}), ...(tenant ? { tenant } : {}) });
}

/**
 * Runs `fn` with `caller` bound; for code outside a request (tests, jobs).
 * The current tenant stays bound unless one is given: switching the account
 * a call runs as never widens what it may see.
 */
export function runAs<T>(caller: Caller | undefined, fn: () => T, tenant?: TenantScope): T {
  const bound = tenant ?? storage.getStore()?.tenant;
  return storage.run({ ...(caller ? { caller } : {}), ...(bound ? { tenant: bound } : {}) }, fn);
}

export function currentTenant(): TenantScope | undefined {
  const store = storage.getStore();
  return store?.unscoped ? undefined : store?.tenant;
}

/**
 * Runs `fn` with the tenant guard stood down. Only for what has to look
 * across tenants before one is known: finding the account behind a sign-in.
 * Grep for it; every use is a place tenancy is deliberately not applied.
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ ...storage.getStore(), unscoped: true }, fn);
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
