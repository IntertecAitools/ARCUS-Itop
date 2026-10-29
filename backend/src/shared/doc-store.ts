import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Small JSON documents the platform keeps next to iTop records that have no
 * field for them (a change's risk answers and review, an article's workflow
 * state): one row per tenant ("" without tenancy), kind and key.
 */
export interface StoredDoc<T> {
  key: string;
  body: T;
  updatedAt: string;
  updatedBy: string;
}

export interface DocStore {
  get<T>(tenantId: string, kind: string, key: string): Promise<StoredDoc<T> | undefined>;
  /** Every document of a kind, or those whose key starts with `prefix`. */
  list<T>(tenantId: string, kind: string, prefix?: string): Promise<StoredDoc<T>[]>;
  put<T>(tenantId: string, kind: string, key: string, body: T, updatedBy: string): Promise<void>;
  delete(tenantId: string, kind: string, key: string): Promise<void>;
}

/** Tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryDocStore implements DocStore {
  private readonly rows = new Map<string, StoredDoc<unknown>>();

  private id(tenantId: string, kind: string, key: string): string {
    return JSON.stringify([tenantId, kind, key]);
  }

  async get<T>(tenantId: string, kind: string, key: string): Promise<StoredDoc<T> | undefined> {
    const row = this.rows.get(this.id(tenantId, kind, key));
    return row ? (structuredClone(row) as StoredDoc<T>) : undefined;
  }

  async list<T>(tenantId: string, kind: string, prefix = ""): Promise<StoredDoc<T>[]> {
    const out: StoredDoc<T>[] = [];
    for (const [id, row] of this.rows) {
      const [t, k] = JSON.parse(id) as [string, string];
      if (t === tenantId && k === kind && row.key.startsWith(prefix)) out.push(structuredClone(row) as StoredDoc<T>);
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  async put<T>(tenantId: string, kind: string, key: string, body: T, updatedBy: string): Promise<void> {
    this.rows.set(this.id(tenantId, kind, key), {
      key,
      body: structuredClone(body),
      updatedBy,
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(tenantId: string, kind: string, key: string): Promise<void> {
    this.rows.delete(this.id(tenantId, kind, key));
  }
}

/** Table `bff_documents` in the BFF's own database, created on first use. */
export class MySqlDocStore implements DocStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_documents (
           tenant_id VARCHAR(64) NOT NULL,
           kind VARCHAR(40) NOT NULL,
           doc_key VARCHAR(190) NOT NULL,
           body MEDIUMTEXT NOT NULL,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           updated_by VARCHAR(255) NOT NULL DEFAULT '',
           PRIMARY KEY (tenant_id, kind, doc_key)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  private toDoc<T>(row: RowDataPacket): StoredDoc<T> | undefined {
    let body: T;
    try {
      body = JSON.parse(String(row["body"])) as T;
    } catch {
      return undefined;
    }
    const at = row["updated_at"];
    return {
      key: String(row["doc_key"]),
      body,
      updatedAt: at instanceof Date ? at.toISOString() : String(at ?? ""),
      updatedBy: String(row["updated_by"] ?? ""),
    };
  }

  async get<T>(tenantId: string, kind: string, key: string): Promise<StoredDoc<T> | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT doc_key, body, updated_at, updated_by FROM bff_documents WHERE tenant_id = ? AND kind = ? AND doc_key = ?",
      [tenantId, kind, key],
    );
    return rows[0] ? this.toDoc<T>(rows[0]) : undefined;
  }

  async list<T>(tenantId: string, kind: string, prefix = ""): Promise<StoredDoc<T>[]> {
    await this.init();
    const like = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT doc_key, body, updated_at, updated_by FROM bff_documents
        WHERE tenant_id = ? AND kind = ? AND doc_key LIKE ? ORDER BY doc_key`,
      [tenantId, kind, like],
    );
    return rows.map((r) => this.toDoc<T>(r)).filter((d): d is StoredDoc<T> => d !== undefined);
  }

  async put<T>(tenantId: string, kind: string, key: string, body: T, updatedBy: string): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_documents (tenant_id, kind, doc_key, body, updated_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE body = VALUES(body), updated_by = VALUES(updated_by)`,
      [tenantId, kind, key, JSON.stringify(body), updatedBy],
    );
  }

  async delete(tenantId: string, kind: string, key: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM bff_documents WHERE tenant_id = ? AND kind = ? AND doc_key = ?", [
      tenantId,
      kind,
      key,
    ]);
  }
}
