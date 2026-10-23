import { AppError } from "../../core/errors.js";
import type { Caller, TenantScope } from "../../core/request-context.js";
import { normalizeDomain, type Tenant, type TenantStore } from "./tenant.store.js";

export interface TenancyConfig {
  /** TENANCY=on: every request is held to one tenant's organisations. */
  enabled: boolean;
  /**
   * PLATFORM_LOGINS: accounts that run the platform rather than belong to a
   * customer. Unscoped on the platform's own address, held to the tenant on
   * a tenant's domain.
   */
  platformLogins: string[];
  /** TENANTS_FILE: tenants from a JSON file instead of the BFF database. */
  tenantsFile?: string;
}

/**
 * What tenant resolution reads from a signed-in user. Kept this small on
 * purpose: whatever session object sign-in produces (password, SSO), it only
 * has to supply these.
 */
export type TenantFacts = Pick<Caller, "login" | "orgId" | "allowedOrgIds">;

/**
 * The tenant an account belongs to: the one owning its person's
 * organisation, else the one owning all of its allowed organisations.
 * Undefined when neither settles it -- such an account belongs to nobody.
 */
export function tenantOfUser(user: TenantFacts, tenants: Tenant[]): Tenant | undefined {
  if (user.orgId > 0) return tenants.find((t) => t.orgIds.includes(user.orgId));
  const allowed = user.allowedOrgIds.filter((n) => n > 0);
  if (allowed.length === 0) return undefined;
  const owner = tenants.find((t) => t.orgIds.includes(allowed[0]!));
  return owner && allowed.every((id) => owner.orgIds.includes(id)) ? owner : undefined;
}

export function scopeOf(tenant: Tenant): TenantScope {
  return { id: tenant.id, name: tenant.name, orgIds: [...tenant.orgIds] };
}

export interface Resolution {
  /** The scope to bind; undefined is unscoped. */
  tenant?: TenantScope;
  /** Set when the signed-in user may not use this site; the request is refused. */
  refused?: AppError;
}

/** Decides each request's tenant from its host name and its signed-in user. */
export class TenantResolver {
  private readonly platformLogins: Set<string>;

  constructor(
    private readonly store: TenantStore,
    private readonly config: TenancyConfig,
  ) {
    this.platformLogins = new Set(config.platformLogins.map((l) => l.toLowerCase()));
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  tenants(): Promise<Tenant[]> {
    return this.store.list();
  }

  /** The tenant owning an organisation, if any. */
  async tenantOfOrg(orgId: number): Promise<Tenant | undefined> {
    return (await this.store.list()).find((t) => t.orgIds.includes(orgId));
  }

  /**
   * - Tenancy off: unscoped.
   * - A tenant's domain: that tenant. Its users only; a disabled one refuses.
   * - Signed in elsewhere: the user's own tenant. A user no tenant claims is
   *   refused, unless it is a platform operator (unscoped).
   */
  async resolve(host: string, user: TenantFacts | undefined): Promise<Resolution> {
    if (!this.config.enabled) return {};
    const tenants = await this.store.list();
    const domain = normalizeDomain(host);
    const site = tenants.find((t) => t.domains.includes(domain));
    if (site?.status === "disabled") {
      return { refused: new AppError("forbidden", "This site is not available.") };
    }
    const siteScope = site ? scopeOf(site) : undefined;
    if (!user) return { ...(siteScope ? { tenant: siteScope } : {}) };

    if (this.platformLogins.has(user.login.toLowerCase())) return { ...(siteScope ? { tenant: siteScope } : {}) };

    const own = tenantOfUser(user, tenants);
    const refuse = (message: string): Resolution => ({
      ...(siteScope ? { tenant: siteScope } : {}),
      refused: new AppError("forbidden", message),
    });
    if (!own) return refuse("Your account is not linked to any customer of this platform. Ask your administrator.");
    if (own.status === "disabled") return refuse("Your organisation's access to this platform is suspended.");
    if (site && site.id !== own.id) return refuse("This account belongs to another site. Sign in at your organisation's address.");
    return { tenant: scopeOf(own) };
  }
}
