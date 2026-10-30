import { readFileSync } from "node:fs";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One customer of the platform, and the iTop organisations that are theirs. */
export interface Tenant {
  /** Short stable id, e.g. "acme". */
  id: string;
  name: string;
  status: "active" | "disabled";
  /** Host names that open this tenant's site, lower case, without port. */
  domains: string[];
  /** iTop Organization ids. An organisation belongs to one tenant at most. */
  orgIds: number[];
  /**
   * Email domains that are this tenant's people: a self-registration, a
   * single sign-on without an account, or an email to the support mailbox
   * from one of them lands in `orgId`. A domain belongs to one tenant at most.
   * Left out on save: kept as it is.
   */
  emailDomains?: EmailDomain[];
  /** Logo, colour and product name of the tenant's site. Left out on save: kept. */
  branding?: TenantBranding;
}

export interface EmailDomain {
  /** "acme.com", lower case. */
  domain: string;
  /** One of the tenant's organisations. */
  orgId: number;
}

export interface TenantBranding {
  /** Replaces "Intertec Servicedesk" in the header, sign-in and portal. */
  productName?: string;
  /** "#rrggbb": drives the brand (violet) tokens. */
  accentColor?: string;
  /** A data URL (PNG, JPEG, WebP or SVG), shown only as an image. */
  logo?: string;
}

export const MAX_LOGO_CHARS = 280_000;
const LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const HEX = /^#[0-9a-f]{6}$/;
const EMAIL_DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Checks one tenant's branding; throws with a message an administrator can act on. */
export function validateBranding(b: TenantBranding): TenantBranding {
  const out: TenantBranding = {};
  if (b.productName !== undefined && b.productName.trim()) {
    const name = b.productName.trim();
    if (name.length > 60) throw new Error("A product name is at most 60 characters.");
    out.productName = name;
  }
  if (b.accentColor !== undefined && b.accentColor !== "") {
    const hex = b.accentColor.trim().toLowerCase();
    if (!HEX.test(hex)) throw new Error("The brand colour must be a hex colour such as #6d4aff.");
    out.accentColor = hex;
  }
  if (b.logo !== undefined && b.logo !== "") {
    if (b.logo.length > MAX_LOGO_CHARS) throw new Error("The logo is too large: keep it under 200 KB.");
    if (!LOGO.test(b.logo)) throw new Error("The logo must be a PNG, JPEG, WebP or SVG image.");
    out.logo = b.logo;
  }
  return out;
}

export function isEmailDomain(domain: string): boolean {
  return EMAIL_DOMAIN.test(domain);
}

/** The tenant and organisation an email address belongs to, by its domain. */
export function tenantOfEmail(email: string, tenants: Tenant[]): { tenant: Tenant; orgId: number } | undefined {
  const at = email.lastIndexOf("@");
  if (at < 0) return undefined;
  const domain = normalizeDomain(email.slice(at + 1));
  for (const tenant of tenants) {
    const hit = tenant.emailDomains?.find((d) => d.domain === domain);
    if (hit) return { tenant, orgId: hit.orgId };
  }
  return undefined;
}

/**
 * Where tenants are kept. Read on every request, so implementations answer
 * from memory and refresh on their own.
 */
export interface TenantStore {
  list(): Promise<Tenant[]>;
  /** Adds or replaces a tenant with its domains and organisations. */
  save(tenant: Tenant): Promise<void>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}

const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Checks a tenant, and that no organisation or domain is claimed twice. */
export function validateTenants(tenants: Tenant[]): Tenant[] {
  const orgOwner = new Map<number, string>();
  const domainOwner = new Map<string, string>();
  const emailOwner = new Map<string, string>();
  for (const t of tenants) {
    for (const { domain, orgId } of t.emailDomains ?? []) {
      if (!isEmailDomain(domain)) throw new Error(`"${domain}" is not an email domain.`);
      if (!t.orgIds.includes(orgId)) throw new Error(`Email domain ${domain}: organisation ${orgId} is not one of ${t.name}'s.`);
      const other = emailOwner.get(domain);
      if (other && other !== t.id) throw new Error(`Email domain ${domain} already belongs to another customer.`);
      if (other) throw new Error(`Email domain ${domain} is listed twice.`);
      emailOwner.set(domain, t.id);
    }
    if (!TENANT_ID.test(t.id)) throw new Error(`Tenant id "${t.id}" must be lower-case letters, digits and dashes.`);
    if (!t.name.trim()) throw new Error(`Tenant ${t.id} needs a name.`);
    for (const org of t.orgIds) {
      if (!Number.isInteger(org) || org <= 0) throw new Error(`Tenant ${t.id}: organisation id ${org} is not an id.`);
      const other = orgOwner.get(org);
      if (other && other !== t.id) throw new Error(`Organisation ${org} belongs to both ${other} and ${t.id}.`);
      orgOwner.set(org, t.id);
    }
    for (const domain of t.domains) {
      const other = domainOwner.get(domain);
      if (other && other !== t.id) throw new Error(`Domain ${domain} belongs to both ${other} and ${t.id}.`);
      domainOwner.set(domain, t.id);
    }
  }
  return tenants;
}

export function normalizeDomain(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

/** Tenants held in memory: tests, and TENANTS_FILE without a database. */
export class MemoryTenantStore implements TenantStore {
  private tenants: Tenant[];

  constructor(tenants: Tenant[] = []) {
    this.tenants = validateTenants(tenants.map(clean));
  }

  /** A JSON array of tenants: `[{ "id", "name", "domains": [], "orgIds": [] }]`. */
  static fromFile(path: string): MemoryTenantStore {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error(`${path} must hold a JSON array of tenants.`);
    return new MemoryTenantStore(raw as Tenant[]);
  }

  async list(): Promise<Tenant[]> {
    return this.tenants;
  }

  async save(tenant: Tenant): Promise<void> {
    const before = this.tenants.find((t) => t.id === tenant.id);
    const next = clean(tenant);
    next.emailDomains ??= (before?.emailDomains ?? []).filter((d) => next.orgIds.includes(d.orgId));
    next.branding ??= before?.branding ?? {};
    this.tenants = validateTenants([...this.tenants.filter((t) => t.id !== tenant.id), next]);
  }

  async remove(id: string): Promise<void> {
    this.tenants = this.tenants.filter((t) => t.id !== id);
  }

  async close(): Promise<void> {}
}

function clean(t: Tenant): Tenant {
  return {
    id: String(t.id),
    name: String(t.name ?? t.id),
    status: t.status === "disabled" ? "disabled" : "active",
    domains: [...new Set((t.domains ?? []).map(normalizeDomain).filter(Boolean))],
    orgIds: [...new Set((t.orgIds ?? []).map(Number))],
    ...(t.emailDomains
      ? { emailDomains: t.emailDomains.map((d) => ({ domain: normalizeDomain(String(d.domain)), orgId: Number(d.orgId) })) }
      : {}),
    ...(t.branding ? { branding: validateBranding(t.branding) } : {}),
  };
}

/**
 * Tenants in the BFF's own database (the one sessions use, never iTop's):
 * `bff_tenants`, `bff_tenant_domains`, `bff_tenant_orgs`. The primary keys
 * of the last two are what keep a domain or an organisation to one tenant.
 * Read into memory and refreshed every `refreshMs`, so a change made with
 * `npm run tenants` reaches every instance within that time.
 */
export class MySqlTenantStore implements TenantStore {
  private ready?: Promise<void>;
  private cached?: { at: number; tenants: Tenant[] };

  constructor(
    private readonly pool: Pool,
    private readonly refreshMs = 30_000,
    private readonly now: () => number = Date.now,
    private readonly ownsPool = false,
  ) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_tenants (
           id VARCHAR(64) NOT NULL PRIMARY KEY,
           name VARCHAR(255) NOT NULL,
           status VARCHAR(16) NOT NULL DEFAULT 'active',
           created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_tenant_domains (
           domain VARCHAR(255) NOT NULL PRIMARY KEY,
           tenant_id VARCHAR(64) NOT NULL,
           KEY tenant (tenant_id),
           CONSTRAINT fk_tenant_domain FOREIGN KEY (tenant_id) REFERENCES bff_tenants (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_tenant_orgs (
           org_id INT NOT NULL PRIMARY KEY,
           tenant_id VARCHAR(64) NOT NULL,
           KEY tenant (tenant_id),
           CONSTRAINT fk_tenant_org FOREIGN KEY (tenant_id) REFERENCES bff_tenants (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_tenant_email_domains (
           domain VARCHAR(255) NOT NULL PRIMARY KEY,
           tenant_id VARCHAR(64) NOT NULL,
           org_id INT NOT NULL,
           KEY tenant (tenant_id),
           CONSTRAINT fk_tenant_email_domain FOREIGN KEY (tenant_id) REFERENCES bff_tenants (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_tenant_branding (
           tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
           product_name VARCHAR(60) NULL,
           accent_color CHAR(7) NULL,
           logo MEDIUMTEXT NULL,
           CONSTRAINT fk_tenant_branding FOREIGN KEY (tenant_id) REFERENCES bff_tenants (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
    })().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async list(): Promise<Tenant[]> {
    if (this.cached && this.now() - this.cached.at < this.refreshMs) return this.cached.tenants;
    await this.init();
    const [tenants] = await this.pool.query<RowDataPacket[]>("SELECT id, name, status FROM bff_tenants ORDER BY id");
    const [domains] = await this.pool.query<RowDataPacket[]>("SELECT domain, tenant_id FROM bff_tenant_domains");
    const [orgs] = await this.pool.query<RowDataPacket[]>("SELECT org_id, tenant_id FROM bff_tenant_orgs");
    const [emails] = await this.pool.query<RowDataPacket[]>("SELECT domain, tenant_id, org_id FROM bff_tenant_email_domains");
    const [brands] = await this.pool.query<RowDataPacket[]>(
      "SELECT tenant_id, product_name, accent_color, logo FROM bff_tenant_branding",
    );
    const list = tenants.map((t): Tenant => {
      const brand = brands.find((b) => b["tenant_id"] === t["id"]);
      return {
        id: String(t["id"]),
        name: String(t["name"]),
        status: t["status"] === "disabled" ? "disabled" : "active",
        domains: domains.filter((d) => d["tenant_id"] === t["id"]).map((d) => String(d["domain"])),
        orgIds: orgs.filter((o) => o["tenant_id"] === t["id"]).map((o) => Number(o["org_id"])),
        emailDomains: emails
          .filter((e) => e["tenant_id"] === t["id"])
          .map((e) => ({ domain: String(e["domain"]), orgId: Number(e["org_id"]) })),
        branding: {
          ...(brand?.["product_name"] ? { productName: String(brand["product_name"]) } : {}),
          ...(brand?.["accent_color"] ? { accentColor: String(brand["accent_color"]) } : {}),
          ...(brand?.["logo"] ? { logo: String(brand["logo"]) } : {}),
        },
      };
    });
    this.cached = { at: this.now(), tenants: list };
    return list;
  }

  async save(tenant: Tenant): Promise<void> {
    await this.init();
    const t = clean(tenant);
    this.cached = undefined;
    const current = await this.list();
    const before = current.find((x) => x.id === t.id);
    validateTenants([
      ...current.filter((x) => x.id !== t.id),
      { ...t, emailDomains: t.emailDomains ?? (before?.emailDomains ?? []).filter((d) => t.orgIds.includes(d.orgId)) },
    ]);
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "INSERT INTO bff_tenants (id, name, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)",
        [t.id, t.name, t.status],
      );
      await conn.query("DELETE FROM bff_tenant_domains WHERE tenant_id = ?", [t.id]);
      await conn.query("DELETE FROM bff_tenant_orgs WHERE tenant_id = ?", [t.id]);
      for (const domain of t.domains) {
        await conn.query("INSERT INTO bff_tenant_domains (domain, tenant_id) VALUES (?, ?)", [domain, t.id]);
      }
      for (const org of t.orgIds) {
        await conn.query("INSERT INTO bff_tenant_orgs (org_id, tenant_id) VALUES (?, ?)", [org, t.id]);
      }
      if (t.emailDomains) {
        await conn.query("DELETE FROM bff_tenant_email_domains WHERE tenant_id = ?", [t.id]);
        for (const { domain, orgId } of t.emailDomains) {
          await conn.query("INSERT INTO bff_tenant_email_domains (domain, tenant_id, org_id) VALUES (?, ?, ?)", [
            domain,
            t.id,
            orgId,
          ]);
        }
      } else {
        // Organisations may have been taken away: their email domains go with them.
        await conn.query(
          `DELETE FROM bff_tenant_email_domains WHERE tenant_id = ?${t.orgIds.length ? ` AND org_id NOT IN (${t.orgIds.map(() => "?").join(",")})` : ""}`,
          [t.id, ...t.orgIds],
        );
      }
      if (t.branding) {
        await conn.query(
          `INSERT INTO bff_tenant_branding (tenant_id, product_name, accent_color, logo) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE product_name = VALUES(product_name), accent_color = VALUES(accent_color), logo = VALUES(logo)`,
          [t.id, t.branding.productName ?? null, t.branding.accentColor ?? null, t.branding.logo ?? null],
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
      this.cached = undefined;
    }
  }

  async remove(id: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM bff_tenants WHERE id = ?", [id]);
    this.cached = undefined;
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
