import type { Pool, RowDataPacket } from "mysql2/promise";

import type { Draft, DraftKind } from "./ticket-handling.types.js";

/**
 * Half-filled "new ticket" forms, per user, in the BFF's own database
 * (table `bff_drafts`). iTop has no notion of a draft ticket: an object
 * exists once it is created, and creating it starts its SLA and notifies.
 * The form's values are one JSON column, always read and written whole.
 */
export interface StoredDraft extends Draft {
  tenant: string;
  userId: number;
}

export interface DraftStore {
  list(tenant: string, userId: number, kind?: DraftKind): Promise<StoredDraft[]>;
  get(tenant: string, userId: number, id: string): Promise<StoredDraft | undefined>;
  save(draft: StoredDraft): Promise<void>;
  remove(tenant: string, userId: number, id: string): Promise<void>;
}

export class MemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, StoredDraft>();

  async list(tenant: string, userId: number, kind?: DraftKind) {
    return [...this.drafts.values()]
      .filter((d) => d.tenant === tenant && d.userId === userId && (!kind || d.kind === kind))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(tenant: string, userId: number, id: string) {
    const d = this.drafts.get(id);
    return d && d.tenant === tenant && d.userId === userId ? d : undefined;
  }

  async save(draft: StoredDraft): Promise<void> {
    this.drafts.set(draft.id, draft);
  }

  async remove(tenant: string, userId: number, id: string): Promise<void> {
    if (await this.get(tenant, userId, id)) this.drafts.delete(id);
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));

export class MySqlDraftStore implements DraftStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_drafts (
           id CHAR(24) NOT NULL PRIMARY KEY,
           tenant VARCHAR(64) NOT NULL DEFAULT '',
           user_id INT NOT NULL,
           kind VARCHAR(32) NOT NULL,
           title VARCHAR(255) NOT NULL DEFAULT '',
           data MEDIUMTEXT NOT NULL,
           created_at DATETIME(3) NOT NULL,
           updated_at DATETIME(3) NOT NULL,
           KEY owner (tenant, user_id, updated_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  private toDraft(r: RowDataPacket): StoredDraft {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(r["data"])) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      // A damaged row reads as an empty form.
    }
    return {
      id: String(r["id"]),
      tenant: String(r["tenant"]),
      userId: Number(r["user_id"]),
      kind: String(r["kind"]) as DraftKind,
      title: String(r["title"]),
      data,
      createdAt: iso(r["created_at"]),
      updatedAt: iso(r["updated_at"]),
    };
  }

  async list(tenant: string, userId: number, kind?: DraftKind) {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM bff_drafts WHERE tenant = ? AND user_id = ?${kind ? " AND kind = ?" : ""} ORDER BY updated_at DESC`,
      kind ? [tenant, userId, kind] : [tenant, userId],
    );
    return rows.map((r) => this.toDraft(r));
  }

  async get(tenant: string, userId: number, id: string) {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM bff_drafts WHERE tenant = ? AND user_id = ? AND id = ?",
      [tenant, userId, id],
    );
    return rows[0] ? this.toDraft(rows[0]) : undefined;
  }

  async save(d: StoredDraft): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_drafts (id, tenant, user_id, kind, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), data = VALUES(data), updated_at = VALUES(updated_at)`,
      [d.id, d.tenant, d.userId, d.kind, d.title, JSON.stringify(d.data), new Date(d.createdAt), new Date(d.updatedAt)],
    );
  }

  async remove(tenant: string, userId: number, id: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM bff_drafts WHERE tenant = ? AND user_id = ? AND id = ?", [tenant, userId, id]);
  }
}
