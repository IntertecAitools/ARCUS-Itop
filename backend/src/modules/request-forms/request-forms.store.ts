import type { Pool, RowDataPacket } from "mysql2/promise";

import type { FormField, FormScope, RequestForm } from "./request-forms.types.js";

/**
 * Where request forms are kept. iTop 3.4 community has no request templates
 * (that is a commercial extension), so the definitions live in the BFF and
 * only the answers reach iTop, written into the request.
 */
export interface RequestFormStore {
  list(): Promise<RequestForm[]>;
  get(scope: FormScope, targetId: number): Promise<RequestForm | undefined>;
  save(form: RequestForm): Promise<void>;
  remove(scope: FormScope, targetId: number): Promise<void>;
}

const keyOf = (scope: FormScope, targetId: number) => `${scope}:${targetId}`;

/** Forms in memory: tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryRequestFormStore implements RequestFormStore {
  private readonly forms = new Map<string, RequestForm>();

  constructor(forms: RequestForm[] = []) {
    for (const f of forms) this.forms.set(keyOf(f.scope, f.targetId), f);
  }

  async list(): Promise<RequestForm[]> {
    return [...this.forms.values()];
  }

  async get(scope: FormScope, targetId: number): Promise<RequestForm | undefined> {
    return this.forms.get(keyOf(scope, targetId));
  }

  async save(form: RequestForm): Promise<void> {
    this.forms.set(keyOf(form.scope, form.targetId), form);
  }

  async remove(scope: FormScope, targetId: number): Promise<void> {
    this.forms.delete(keyOf(scope, targetId));
  }
}

/**
 * Forms in the BFF's own database (the one sessions use, never iTop's), table
 * `bff_request_forms`, created on first use. The field list is one JSON
 * column: it is always read and written whole.
 */
export class MySqlRequestFormStore implements RequestFormStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_request_forms (
           scope VARCHAR(16) NOT NULL,
           target_id INT NOT NULL,
           fields MEDIUMTEXT NOT NULL,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           updated_by VARCHAR(255) NOT NULL DEFAULT '',
           PRIMARY KEY (scope, target_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  private toForm(row: RowDataPacket): RequestForm {
    let fields: FormField[] = [];
    try {
      const parsed = JSON.parse(String(row["fields"])) as unknown;
      if (Array.isArray(parsed)) fields = parsed as FormField[];
    } catch {
      // A damaged row reads as an empty form rather than breaking every request.
    }
    const at = row["updated_at"];
    return {
      scope: row["scope"] === "subcategory" ? "subcategory" : "service",
      targetId: Number(row["target_id"]),
      fields,
      updatedAt: at instanceof Date ? at.toISOString() : String(at ?? ""),
      updatedBy: String(row["updated_by"] ?? ""),
    };
  }

  async list(): Promise<RequestForm[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT scope, target_id, fields, updated_at, updated_by FROM bff_request_forms",
    );
    return rows.map((r) => this.toForm(r));
  }

  async get(scope: FormScope, targetId: number): Promise<RequestForm | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT scope, target_id, fields, updated_at, updated_by FROM bff_request_forms WHERE scope = ? AND target_id = ?",
      [scope, targetId],
    );
    return rows[0] ? this.toForm(rows[0]) : undefined;
  }

  async save(form: RequestForm): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_request_forms (scope, target_id, fields, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fields = VALUES(fields), updated_by = VALUES(updated_by)`,
      [form.scope, form.targetId, JSON.stringify(form.fields), form.updatedBy],
    );
  }

  async remove(scope: FormScope, targetId: number): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM bff_request_forms WHERE scope = ? AND target_id = ?", [scope, targetId]);
  }
}
