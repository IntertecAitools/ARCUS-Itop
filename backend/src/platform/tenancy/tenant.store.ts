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
  for (const t of tenants) {
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
    this.tenants = validateTenants([...this.tenants.filter((t) => t.id !== tenant.id), clean(tenant)]);
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
    const list = tenants.map((t) => ({
      id: String(t["id"]),
      name: String(t["name"]),
      status: t["status"] === "disabled" ? ("disabled" as const) : ("active" as const),
      domains: domains.filter((d) => d["tenant_id"] === t["id"]).map((d) => String(d["domain"])),
      orgIds: orgs.filter((o) => o["tenant_id"] === t["id"]).map((o) => Number(o["org_id"])),
    }));
    this.cached = { at: this.now(), tenants: list };
    return list;
  }

  async save(tenant: Tenant): Promise<void> {
    await this.init();
    const t = clean(tenant);
    this.cached = undefined;
    validateTenants([...(await this.list()).filter((x) => x.id !== t.id), t]);
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
