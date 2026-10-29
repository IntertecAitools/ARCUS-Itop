import type { Pool, RowDataPacket } from "mysql2/promise";

import type { ImportReport, ImportReportListItem } from "./data-import.types.js";

/** Reports kept per tenant; older ones are dropped. */
export const KEPT_REPORTS = 50;

/**
 * Where finished imports are kept, one list per tenant ("" without
 * tenancy), so an admin can read and download one later. iTop has nowhere
 * for them: its own CSV import keeps no report either.
 */
export interface ImportReportStore {
  save(tenantId: string, report: ImportReport): Promise<void>;
  list(tenantId: string): Promise<ImportReportListItem[]>;
  get(tenantId: string, id: string): Promise<ImportReport | undefined>;
}

const listItem = ({ rows: _rows, ...item }: ImportReport): ImportReportListItem => item;

/** Tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryImportReportStore implements ImportReportStore {
  private readonly byTenant = new Map<string, ImportReport[]>();

  async save(tenantId: string, report: ImportReport): Promise<void> {
    const reports = [report, ...(this.byTenant.get(tenantId) ?? [])].slice(0, KEPT_REPORTS);
    this.byTenant.set(tenantId, reports);
  }

  async list(tenantId: string): Promise<ImportReportListItem[]> {
    return (this.byTenant.get(tenantId) ?? []).map(listItem);
  }

  async get(tenantId: string, id: string): Promise<ImportReport | undefined> {
    return this.byTenant.get(tenantId)?.find((r) => r.id === id);
  }
}

/** Table `bff_import_reports` in the BFF's own database, created on first use. */
export class MySqlImportReportStore implements ImportReportStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_import_reports (
           id VARCHAR(64) NOT NULL,
           tenant_id VARCHAR(64) NOT NULL,
           finished_at VARCHAR(32) NOT NULL,
           report MEDIUMTEXT NOT NULL,
           PRIMARY KEY (id),
           KEY tenant_finished (tenant_id, finished_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async save(tenantId: string, report: ImportReport): Promise<void> {
    await this.init();
    await this.pool.query("INSERT INTO bff_import_reports (id, tenant_id, finished_at, report) VALUES (?, ?, ?, ?)", [
      report.id,
      tenantId,
      report.finishedAt,
      JSON.stringify(report),
    ]);
    // Keep the newest KEPT_REPORTS of this tenant.
    const [old] = await this.pool.query<RowDataPacket[]>(
      "SELECT id FROM bff_import_reports WHERE tenant_id = ? ORDER BY finished_at DESC LIMIT 1000 OFFSET ?",
      [tenantId, KEPT_REPORTS],
    );
    if (old.length > 0) {
      await this.pool.query("DELETE FROM bff_import_reports WHERE id IN (?)", [old.map((r) => String(r["id"]))]);
    }
  }

  async list(tenantId: string): Promise<ImportReportListItem[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT report FROM bff_import_reports WHERE tenant_id = ? ORDER BY finished_at DESC LIMIT ?",
      [tenantId, KEPT_REPORTS],
    );
    return rows.flatMap((row) => {
      const report = parse(row["report"]);
      return report ? [listItem(report)] : [];
    });
  }

  async get(tenantId: string, id: string): Promise<ImportReport | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT report FROM bff_import_reports WHERE tenant_id = ? AND id = ?",
      [tenantId, id],
    );
    return rows[0] ? parse(rows[0]["report"]) : undefined;
  }
}

function parse(raw: unknown): ImportReport | undefined {
  try {
    return JSON.parse(String(raw)) as ImportReport;
  } catch {
    return undefined;
  }
}
