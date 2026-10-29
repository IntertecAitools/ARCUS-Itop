import { randomUUID } from "node:crypto";

import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";
import { writeCsv } from "../../platform/transfer/csv.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { validateWrite } from "../../shared/write-validation.js";
import type {
  FieldChange,
  ImportClass,
  ImportPlan,
  ImportReport,
  ImportReportListItem,
  ImportRequest,
  PlannedRow,
  ReportRow,
} from "./data-import.types.js";
import {
  assertImportClass,
  chunks,
  comparable,
  importClasses,
  keyPart,
  mapLimit,
  parseTarget,
  type ColumnTarget,
} from "./import-plan.js";
import type { ImportReportStore } from "./report-store.js";

/**
 * Most rows one import takes. Each row is one REST call (iTop's REST API has
 * no bulk create), about 0.05-0.15 s, run four at a time: 2,000 rows stay
 * well inside the platform's 300 s request limit.
 */
export const MAX_IMPORT_ROWS = 2000;
/** Rows matched against iTop per query, and references looked up per query. */
const LOOKUP_BATCH = 50;
/** Writes in flight at once. */
const WRITE_CONCURRENCY = 4;

/** A planned row with what running it sends to iTop. */
interface WorkRow extends PlannedRow {
  fields: Record<string, unknown>;
}

/**
 * The admin import wizard: a file's rows, mapped to a class's fields,
 * matched to existing records on chosen keys, previewed row by row, then
 * written with iTop's REST API (core/create, core/update) in batches.
 *
 * Every iTop call runs as the signed-in admin, through the tenant guard: a
 * row the admin may not write, or that names another tenant's organisation,
 * fails on its own and the rest go through.
 */
export class DataImportService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly reports: ImportReportStore,
    private readonly timeZone: string,
  ) {}

  classes(): ImportClass[] {
    return importClasses(this.schema);
  }

  /** The dry run: nothing is written. */
  async plan(className: string, request: ImportRequest): Promise<ImportPlan> {
    const { plan } = await this.work(className, request);
    return plan;
  }

  /**
   * Runs the import: plans it again against iTop as it is now (the preview
   * may be stale), then writes the creates and updates, four at a time. One
   * row failing never stops the rest. The report is kept.
   */
  async run(className: string, request: ImportRequest): Promise<ImportReport> {
    const startedAt = new Date().toISOString();
    const { info, work } = await this.work(className, request);
    const comment = request.comment?.trim() || `Data import${request.fileName ? ` from ${request.fileName}` : ""}`;

    const rows = await mapLimit(work, WRITE_CONCURRENCY, async (row): Promise<ReportRow> => {
      const base = { line: row.line, key: row.key, changes: row.changes };
      if (row.action === "error") return { ...base, outcome: "error", errors: row.errors };
      if (row.action === "unchanged") return { ...base, outcome: "unchanged", id: row.id!, errors: [] };
      try {
        if (row.action === "create") {
          const result = await this.client.call("core/create", {
            class: info.name,
            fields: row.fields,
            output_fields: "id",
            comment,
          });
          const id = normalizeObjects(result.objects)[0]?.id;
          return { ...base, outcome: "created", ...(id ? { id } : {}), errors: [] };
        }
        const changed = Object.fromEntries(row.changes.map((c) => [c.field, row.fields[c.field]]));
        await this.client.call("core/update", {
          class: info.name,
          key: row.id,
          fields: changed,
          output_fields: "id",
          comment,
        });
        return { ...base, outcome: "updated", id: row.id!, errors: [] };
      } catch (error) {
        return { ...base, outcome: "error", ...(row.id ? { id: row.id } : {}), errors: [messageOf(error)] };
      }
    });

    const report: ImportReport = {
      id: randomUUID(),
      className: info.name,
      fileName: request.fileName ?? "",
      startedAt,
      finishedAt: new Date().toISOString(),
      by: currentCaller()?.login ?? "",
      summary: {
        created: rows.filter((r) => r.outcome === "created").length,
        updated: rows.filter((r) => r.outcome === "updated").length,
        unchanged: rows.filter((r) => r.outcome === "unchanged").length,
        error: rows.filter((r) => r.outcome === "error").length,
      },
      rows,
    };
    await this.reports.save(tenantKey(), report);
    return report;
  }

  async listReports(): Promise<ImportReportListItem[]> {
    return this.reports.list(tenantKey());
  }

  async report(id: string): Promise<ImportReport> {
    const report = await this.reports.get(tenantKey(), id);
    if (!report) throw notFound("No such import report.");
    return report;
  }

  /** The report as CSV: one line per row of the file. */
  async reportCsv(id: string): Promise<{ filename: string; csv: string }> {
    const report = await this.report(id);
    const rows = [
      ["Line", "Outcome", "Record id", "Key", "Changes", "Errors"],
      ...report.rows.map((r) => [
        String(r.line),
        r.outcome,
        r.id ? String(r.id) : "",
        r.key,
        r.changes.map((c) => `${c.field}: ${c.from} -> ${c.to}`).join("; "),
        r.errors.join("; "),
      ]),
    ];
    // A cell starting = + - @ would run as a formula in a spreadsheet.
    const safe = rows.map((r) => r.map((c) => (/^[=+\-@\t\r]/.test(c) ? `'${c}` : c)));
    return {
      filename: `import-${report.className}-${report.finishedAt.slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      csv: "﻿" + writeCsv(safe, ",", '"'),
    };
  }

  // -------------------------------------------------------------------------

  private async work(className: string, request: ImportRequest): Promise<{ info: ClassInfo; plan: ImportPlan; work: WorkRow[] }> {
    const info = assertImportClass(this.schema, className);
    if (request.rows.length === 0) throw badRequest("The file has no rows to import.");
    if (request.rows.length > MAX_IMPORT_ROWS) {
      throw badRequest(
        `This file has ${request.rows.length.toLocaleString("en")} rows; one import takes at most ` +
          `${MAX_IMPORT_ROWS.toLocaleString("en")}. Split it into smaller files.`,
        { rows: request.rows.length, max: MAX_IMPORT_ROWS },
      );
    }

    // Columns: each mapped once, each a field of the class.
    const columns: { index: number; target: ColumnTarget }[] = [];
    const seen = new Set<string>();
    request.columns.forEach((target, index) => {
      if (target === null) return;
      const parsed = parseTarget(this.schema, info, target);
      if (seen.has(parsed.code)) throw badRequest(`Two columns fill "${parsed.code}"; map it once.`);
      seen.add(parsed.code);
      columns.push({ index, target: parsed });
    });
    if (columns.length === 0) throw badRequest("Every column is skipped; map at least one.");

    const keys = request.keys.map((key) => {
      const column = columns.find((c) => c.target.target === key);
      if (!column) throw badRequest(`The key "${key}" is not one of the mapped columns.`);
      return column.target;
    });

    const references = await this.resolveReferences(columns, request.rows);

    // Each row's values, typed as iTop takes them, and what is wrong with it.
    const prepared = request.rows.map((cells, i) => {
      const errors: string[] = [];
      const fields: Record<string, unknown> = {};
      const shown: Record<string, string> = {};
      let id: number | undefined;
      for (const { index, target } of columns) {
        const cell = (cells[index] ?? "").trim();
        if (cell === "") continue;
        shown[target.code] = cell;
        if (target.code === "id") {
          if (/^\d+$/.test(cell)) id = Number(cell);
          else errors.push(`"${cell}" is not a record id.`);
          continue;
        }
        let value: unknown = cell;
        if (target.lookup !== undefined) {
          const found = references.get(target.code)?.get(keyPart(cell)) ?? [];
          const what = target.field?.target ?? "record";
          if (found.length === 0) {
            errors.push(`No ${what} has ${target.lookup} "${cell}" (or it is not one you can see).`);
            continue;
          }
          if (found.length > 1) {
            errors.push(`${found.length} ${what} records have ${target.lookup} "${cell}"; match on a field that is unique.`);
            continue;
          }
          value = found[0];
        }
        try {
          Object.assign(fields, validateWrite(info, { [target.code]: value }, { mode: "update", timeZone: this.timeZone }).fields);
        } catch (error) {
          errors.push(messageOf(error));
        }
      }
      const keyValues = keys.map((k) => (k.code === "id" ? id : fields[k.code]));
      // A key cell that holds something but failed has its error already.
      for (const k of keys) {
        if (shown[k.code] === undefined) errors.push(`The key column "${k.target}" is empty.`);
      }
      const key = keys.map((k) => `${k.target}=${shown[k.code] ?? ""}`).join(", ");
      return { line: i + 2, errors, fields, shown, id, keyValues, key };
    });

    // Existing records, by the rows' keys.
    const outputCodes = columns.filter((c) => c.target.code !== "id").map((c) => c.target.code);
    const matchable = prepared.filter((p) => p.errors.length === 0 && keys.length > 0);
    const existing = await this.findExisting(info, keys, matchable.map((p) => p.keyValues), outputCodes);

    const firstLine = new Map<string, number>();
    const work: WorkRow[] = prepared.map((p) => {
      const row: WorkRow = { line: p.line, action: "error", key: p.key, changes: [], errors: p.errors, fields: p.fields };
      if (p.errors.length > 0) return row;

      if (keys.length > 0) {
        const signature = p.keyValues.map(keyPart).join("\u0001");
        const earlier = firstLine.get(signature);
        if (earlier !== undefined) {
          row.errors = [`Same key as line ${earlier}; each record can be in the file once.`];
          return row;
        }
        firstLine.set(signature, p.line);
        const matches = existing.get(signature) ?? [];
        if (matches.length > 1) {
          row.errors = [`${matches.length} records match this key (ids ${matches.map((m) => m.id).join(", ")}); pick a key that is unique.`];
          return row;
        }
        const match = matches[0];
        if (match) {
          row.id = match.id;
          row.changes = this.changes(info, columns, keys, p.fields, p.shown, match);
          row.action = row.changes.length > 0 ? "update" : "unchanged";
          return row;
        }
        if (keys.some((k) => k.code === "id")) {
          row.errors = [`No ${info.labels?.class ?? info.name} has id ${p.id ?? ""}.`];
          return row;
        }
      }
      // A new record: it must have what iTop requires.
      try {
        validateWrite(info, p.fields, { mode: "create", timeZone: this.timeZone });
        row.action = "create";
        row.changes = Object.keys(p.fields).map((field) => ({ field, from: "", to: p.shown[field] ?? String(p.fields[field]) }));
      } catch (error) {
        row.errors = [messageOf(error)];
      }
      return row;
    });

    const plan: ImportPlan = {
      className: info.name,
      columns: columns.map((c) => c.target.target),
      keys: keys.map((k) => k.target),
      summary: {
        create: work.filter((r) => r.action === "create").length,
        update: work.filter((r) => r.action === "update").length,
        unchanged: work.filter((r) => r.action === "unchanged").length,
        error: work.filter((r) => r.action === "error").length,
      },
      rows: work.map(({ fields: _fields, ...row }) => row),
    };
    return { info, plan, work };
  }

  /**
   * Looks up every reference column's values in the class it points at:
   * column code -> value (lower case) -> the ids that have it. Through the
   * tenant guard, so another tenant's records are never found.
   */
  private async resolveReferences(
    columns: { index: number; target: ColumnTarget }[],
    rows: string[][],
  ): Promise<Map<string, Map<string, number[]>>> {
    const out = new Map<string, Map<string, number[]>>();
    for (const { index, target } of columns) {
      if (target.lookup === undefined || !target.field?.target) continue;
      const values = [...new Set(rows.map((r) => (r[index] ?? "").trim()).filter(Boolean))];
      const found = new Map<string, number[]>();
      const targetClass = target.field.target;
      for (const batch of chunks(values, LOOKUP_BATCH)) {
        const list = batch.map((v) => (target.lookup === "id" ? String(Number(v) || 0) : quoteString(v))).join(", ");
        const result = await this.client.call("core/get", {
          class: targetClass,
          key: `SELECT ${targetClass} WHERE ${target.lookup} IN (${list})`,
          output_fields: target.lookup === "id" ? "id" : `id,${target.lookup}`,
        });
        for (const object of normalizeObjects(result.objects)) {
          const value = keyPart(target.lookup === "id" ? object.id : object.fields[target.lookup]);
          found.set(value, [...(found.get(value) ?? []), object.id]);
        }
      }
      out.set(target.code, found);
    }
    return out;
  }

  /**
   * The records the rows' keys match, by key signature. One OQL per batch
   * of rows: `(k1 = a AND k2 = b) OR (...)`.
   */
  private async findExisting(
    info: ClassInfo,
    keys: ColumnTarget[],
    rows: unknown[][],
    outputCodes: string[],
  ): Promise<Map<string, FlatObject[]>> {
    const out = new Map<string, FlatObject[]>();
    if (keys.length === 0 || rows.length === 0) return out;
    const pickerNames = outputCodes.filter((c) => info.fields[c]?.ui === "picker").map((c) => `${c}_friendlyname`);
    const outputFields = ["id", ...outputCodes, ...pickerNames].join(",");
    const literal = (key: ColumnTarget, value: unknown) =>
      key.code === "id" || key.field?.ui === "picker" ? String(Number(value) || 0) : quoteString(String(value));
    const signatures = new Set(rows.map((values) => values.map(keyPart).join("\u0001")));
    const unique = [...signatures].map((s) => rows.find((values) => values.map(keyPart).join("\u0001") === s)!);

    for (const batch of chunks(unique, LOOKUP_BATCH)) {
      const where =
        keys.length === 1
          ? `${keys[0]!.code} IN (${batch.map((v) => literal(keys[0]!, v[0])).join(", ")})`
          : batch.map((v) => `(${keys.map((k, n) => `${k.code} = ${literal(k, v[n])}`).join(" AND ")})`).join(" OR ");
      const result = await this.client.call("core/get", {
        class: info.name,
        key: `SELECT ${info.name} WHERE ${where}`,
        output_fields: outputFields,
      });
      for (const object of normalizeObjects(result.objects)) {
        const signature = keys.map((k) => keyPart(k.code === "id" ? object.id : object.fields[k.code])).join("\u0001");
        if (!signatures.has(signature)) continue;
        const list = out.get(signature) ?? [];
        if (!list.some((o) => o.id === object.id)) list.push(object);
        out.set(signature, list);
      }
    }
    return out;
  }

  /**
   * The fields a row would change on the record it matched, shown as text.
   * A key matched without regard to case, so a key differing only in case
   * is no change: the file's "ANN@X.COM" does not rewrite "ann@x.com".
   */
  private changes(
    info: ClassInfo,
    columns: { target: ColumnTarget }[],
    keys: ColumnTarget[],
    fields: Record<string, unknown>,
    shown: Record<string, string>,
    match: FlatObject,
  ): FieldChange[] {
    const out: FieldChange[] = [];
    for (const { target } of columns) {
      const code = target.code;
      if (code === "id" || !(code in fields)) continue;
      const field = info.fields[code];
      const before = comparable(field, match.fields[code]);
      const after = comparable(field, fields[code]);
      if (before === after) continue;
      if (keys.some((k) => k.code === code) && keyPart(before) === keyPart(after)) continue;
      const from = field?.ui === "picker" ? String(match.fields[`${code}_friendlyname`] ?? before) : String(match.fields[code] ?? "");
      out.push({ field: code, from, to: shown[code] ?? after });
    }
    return out;
  }
}

function tenantKey(): string {
  return currentTenant()?.id ?? "";
}

function messageOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
