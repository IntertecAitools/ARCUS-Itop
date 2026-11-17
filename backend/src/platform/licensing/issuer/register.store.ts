import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { IssueRequest } from "./issue.js";

/**
 * The licence register (LIC-02): every licence Intertec issued, re-issued or
 * revoked, who did it, when and why. Kept in the platform's BFF database
 * (`bff_licence_register`, SESSION_STORE=mysql) or, on an engineer's machine,
 * a JSON file. Rows are never deleted.
 */
export interface RegisterEntry {
  licenceId: string;
  customer: string;
  orderRef: string;
  binding: string;
  edition: string;
  licenceType: string;
  validFrom: string;
  expiresAt: string | null;
  kid: string;
  /** The `.lic` text, as issued. */
  text: string;
  /** The request it was built from, so a re-issue can change one thing. */
  request: IssueRequest;
  issuedBy: string;
  issuedAt: string;
  reason: string;
  /** The licence this one replaces. */
  replaces: string | null;
  /** Set when a later licence replaced this one. */
  replacedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface RegisterStore {
  /** The next free id for a year: ARC-2026-000123. */
  nextId(year: number): Promise<string>;
  add(entry: RegisterEntry): Promise<void>;
  get(licenceId: string): Promise<RegisterEntry | undefined>;
  list(filter?: { customer?: string }): Promise<RegisterEntry[]>;
  markReplaced(licenceId: string, by: string): Promise<void>;
  revoke(licenceId: string, by: string, reason: string, at: string): Promise<void>;
}

export const formatLicenceId = (year: number, n: number) => `ARC-${year}-${String(n).padStart(6, "0")}`;

function nextFrom(ids: string[], year: number): string {
  const prefix = `ARC-${year}-`;
  const max = ids.filter((id) => id.startsWith(prefix)).reduce((m, id) => Math.max(m, Number(id.slice(prefix.length)) || 0), 0);
  return formatLicenceId(year, max + 1);
}

const matches = (e: RegisterEntry, filter?: { customer?: string }) =>
  !filter?.customer || e.customer.toLowerCase().includes(filter.customer.toLowerCase());

export class MemoryRegisterStore implements RegisterStore {
  protected entries: RegisterEntry[] = [];
  async nextId(year: number) {
    return nextFrom(this.entries.map((e) => e.licenceId), year);
  }
  async add(entry: RegisterEntry) {
    if (this.entries.some((e) => e.licenceId === entry.licenceId)) throw new Error(`Licence ${entry.licenceId} is already in the register.`);
    this.entries.push(structuredClone(entry));
    this.save();
  }
  async get(id: string) {
    const e = this.entries.find((x) => x.licenceId === id);
    return e ? structuredClone(e) : undefined;
  }
  async list(filter?: { customer?: string }) {
    return this.entries.filter((e) => matches(e, filter)).map((e) => structuredClone(e));
  }
  async markReplaced(id: string, by: string) {
    const e = this.entries.find((x) => x.licenceId === id);
    if (e) e.replacedBy = by;
    this.save();
  }
  async revoke(id: string, by: string, reason: string, at: string) {
    const e = this.entries.find((x) => x.licenceId === id);
    if (!e) throw new Error(`No licence ${id} in the register.`);
    if (e.revokedAt) throw new Error(`Licence ${id} was already revoked on ${e.revokedAt}.`);
    Object.assign(e, { revokedAt: at, revokedBy: by, revokeReason: reason });
    this.save();
  }
  protected save(): void {}
}

/** The register in a JSON file: for an engineer's machine, never production. */
export class FileRegisterStore extends MemoryRegisterStore {
  constructor(private readonly path: string) {
    super();
    try {
      this.entries = JSON.parse(readFileSync(path, "utf8")) as RegisterEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  protected override save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.entries, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }
}

interface Row extends RowDataPacket {
  licence_id: string;
  entry: string;
  replaced_by: string | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export class MySqlRegisterStore implements RegisterStore {
  private ready?: Promise<void>;
  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_licence_register (
           licence_id VARCHAR(64) NOT NULL PRIMARY KEY,
           customer VARCHAR(200) NOT NULL,
           order_ref VARCHAR(64) NOT NULL,
           binding_ref VARCHAR(200) NOT NULL,
           expires_at DATE NULL,
           issued_at DATETIME(3) NOT NULL,
           issued_by VARCHAR(200) NOT NULL,
           reason VARCHAR(500) NOT NULL,
           replaces VARCHAR(64) NULL,
           replaced_by VARCHAR(64) NULL,
           revoked_at DATETIME(3) NULL,
           revoked_by VARCHAR(200) NULL,
           revoke_reason VARCHAR(500) NULL,
           entry MEDIUMTEXT NOT NULL,
           KEY bff_licence_register_customer (customer),
           KEY bff_licence_register_expires (expires_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined);
    return this.ready;
  }

  private toEntry(r: Row): RegisterEntry {
    const e = JSON.parse(r.entry) as RegisterEntry;
    return {
      ...e,
      replacedBy: r.replaced_by,
      revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      revokedBy: r.revoked_by,
      revokeReason: r.revoke_reason,
    };
  }

  async nextId(year: number) {
    await this.init();
    const [rows] = await this.pool.query<Row[]>("SELECT licence_id FROM bff_licence_register WHERE licence_id LIKE ?", [`ARC-${year}-%`]);
    return nextFrom(rows.map((r) => r.licence_id), year);
  }
  async add(e: RegisterEntry) {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_licence_register (licence_id, customer, order_ref, binding_ref, expires_at, issued_at, issued_by, reason, replaces, entry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.licenceId, e.customer, e.orderRef, e.binding, e.expiresAt, new Date(e.issuedAt), e.issuedBy, e.reason, e.replaces, JSON.stringify(e)],
    );
  }
  async get(id: string) {
    await this.init();
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM bff_licence_register WHERE licence_id = ?", [id]);
    return rows[0] ? this.toEntry(rows[0]) : undefined;
  }
  async list(filter?: { customer?: string }) {
    await this.init();
    const [rows] = filter?.customer
      ? await this.pool.query<Row[]>("SELECT * FROM bff_licence_register WHERE customer LIKE ? ORDER BY issued_at", [`%${filter.customer}%`])
      : await this.pool.query<Row[]>("SELECT * FROM bff_licence_register ORDER BY issued_at");
    return rows.map((r) => this.toEntry(r));
  }
  async markReplaced(id: string, by: string) {
    await this.init();
    await this.pool.query("UPDATE bff_licence_register SET replaced_by = ? WHERE licence_id = ?", [by, id]);
  }
  async revoke(id: string, by: string, reason: string, at: string) {
    await this.init();
    const [res] = await this.pool.query<import("mysql2").ResultSetHeader>(
      "UPDATE bff_licence_register SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE licence_id = ? AND revoked_at IS NULL",
      [new Date(at), by, reason, id],
    );
    if (res.affectedRows !== 1) throw new Error(`No unrevoked licence ${id} in the register.`);
  }
}
