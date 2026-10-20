import { AppError, badRequest } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import type { CmdbSchema } from "../../schema/load.js";
import { parseCsv, remapCsv, writeCsv } from "./csv.js";

/** The export formats offered, as iTop's export-v2.php names them. */
export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportFile {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filename: string;
}

export interface ImportOptions {
  csv: string;
  /** Dry run: iTop parses and checks every line but writes nothing. */
  simulate: boolean;
  /** Columns that identify an existing record to update; none = create all. */
  reconciliationKeys?: string[];
  separator?: string;
  qualifier?: string;
  comment?: string;
  /**
   * The column each of the file's columns loads into (an attribute code,
   * `id`, or `org_id->name`), in file order; null skips that column. Lets a
   * file whose headings are labels, or another system's names, be imported
   * without editing it. Reconciliation keys then name the mapped columns.
   */
  mapping?: (string | null)[];
}

export type ImportRowKind = "created" | "updated" | "unchanged" | "error" | "other";

export interface ImportReport {
  simulated: boolean;
  summary: { issues: number; warnings: number; created: number; updated: number; unchanged: number };
  /** iTop's other remarks: unknown columns, a missing key, a refused file. */
  messages: string[];
  columns: string[];
  rows: { line: number; kind: ImportRowKind; status: string; class: string; id: string; cells: string[] }[];
}

/** Most CSV text one import accepts; iTop's own default post limit is far above. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * Bulk export and CSV import, through iTop's own scripts.
 *
 * Neither exists on the REST API. export-v2.php renders the file (iTop does
 * the CSV quoting, the Excel workbook and the PDF), and import.php runs
 * iTop's bulk loader with its reconciliation, so behaviour matches the
 * console's export and CSV import exactly. The BFF supplies the OQL and the
 * credentials and turns the scripts' text answers into something checkable.
 */
export class TransferService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
  ) {}

  async export(className: string, oql: string, format: ExportFormat, fields?: string): Promise<ExportFile> {
    const info = this.schema.require(className);
    if (!EXPORT_FORMATS.includes(format)) throw badRequest(`Unknown export format "${format}".`);

    const params: Record<string, string> = { expression: oql, format };
    if (fields) params["fields"] = this.checkFields(info.name, fields);
    if (format === "csv") {
      params["charset"] = "UTF-8";
      params["separator"] = ",";
    }

    const response = await this.client.postScript("webservices/export-v2.php", params);

    // Success is a download; anything else (a login form, "Error: …") is a
    // page iTop rendered with HTTP 200.
    const disposition = response.headers.get("content-disposition") ?? "";
    if (!/attachment/i.test(disposition) || !response.body) {
      const text = stripHtml(await response.text());
      throw new AppError("upstream_error", `iTop refused the export: ${text || "no file was produced."}`);
    }

    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      filename: `${info.name}-${new Date().toISOString().slice(0, 10)}.${format}`,
    };
  }

  /**
   * Runs iTop's CSV import. The header row names attribute codes (`name`,
   * `org_id`, or `org_id->name` to match a related record by its name), as
   * iTop's CSV import expects with `no_localize`.
   */
  async import(className: string, options: ImportOptions): Promise<ImportReport> {
    const info = this.schema.require(className);
    if (info.abstract) {
      throw badRequest(`${info.name} is abstract; import into one of its concrete classes.`);
    }
    if (options.csv.trim() === "") throw badRequest("The file is empty.");
    if (Buffer.byteLength(options.csv, "utf8") > MAX_IMPORT_BYTES) {
      throw badRequest(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
    }
    for (const char of [options.separator, options.qualifier]) {
      if (char !== undefined && char.length !== 1) throw badRequest("Separator and qualifier are single characters.");
    }

    const separator = options.separator ?? ",";
    const qualifier = options.qualifier ?? '"';
    const csvdata = options.mapping
      ? this.applyMapping(info.name, options.csv, separator, qualifier, options.mapping)
      : options.csv;

    const params: Record<string, string> = {
      class: info.name,
      csvdata,
      charset: "UTF-8",
      separator,
      qualifier,
      output: "details",
      no_localize: "1",
      simulate: options.simulate ? "1" : "0",
    };
    if (options.reconciliationKeys?.length) {
      params["reconciliationkeys"] = options.reconciliationKeys.join(",");
    }
    if (options.comment) params["comment"] = options.comment;

    const response = await this.client.postScript("webservices/import.php", params);
    return parseImportReport(await response.text(), options.simulate);
  }

  /** Rewrites the file with the mapped headings, leaving out skipped columns. */
  private applyMapping(
    className: string,
    csv: string,
    separator: string,
    qualifier: string,
    mapping: (string | null)[],
  ): string {
    const rows = parseCsv(csv, separator, qualifier);
    const header = rows[0] ?? [];
    if (mapping.length !== header.length) {
      throw badRequest(`The mapping lists ${mapping.length} columns but the file has ${header.length}.`);
    }
    const targets = mapping.filter((t): t is string => t !== null);
    if (targets.length === 0) throw badRequest("Every column is skipped; map at least one.");
    const seen = new Set<string>();
    for (const target of targets) {
      this.checkImportColumn(className, target);
      if (seen.has(target)) throw badRequest(`Two file columns are mapped to "${target}".`);
      seen.add(target);
    }
    return writeCsv(remapCsv(rows, mapping), separator, qualifier);
  }

  /** An import column: `id`, an attribute, or a picker matched on its target's field. */
  private checkImportColumn(className: string, column: string): void {
    const info = this.schema.require(className);
    if (column === "id") return;
    const [code, ...path] = column.split("->");
    const field = code ? info.fields[code] : undefined;
    if (!field) throw badRequest(`Unknown attribute "${code}" on ${className}.`);
    if (path.length > 0 && (field.ui !== "picker" || !path.every((p) => /^[A-Za-z0-9_]+$/.test(p)))) {
      throw badRequest(`"${column}" is not a column iTop can import.`);
    }
  }

  /** Export columns must be real attributes of the class. */
  private checkFields(className: string, fields: string): string {
    const info = this.schema.require(className);
    const codes = fields.split(",").map((f) => f.trim()).filter(Boolean);
    for (const code of codes) {
      const base = code.endsWith("_friendlyname") ? code.slice(0, -"_friendlyname".length) : code;
      if (code !== "id" && code !== "friendlyname" && !info.fields[base]) {
        throw badRequest(`Unknown attribute "${code}" on ${className}.`);
      }
    }
    return codes.join(",");
  }
}

/**
 * Reads import.php's `output=details` answer (sources/Application/WebPage/
 * CSVPage.php): `#`-prefixed remarks, including the counts, then a
 * `;`-joined table whose first four columns are Line, Status, Object Class
 * and Object Id. Row statuses are iTop's own wording: `created`,
 * `updated N cols`, `unchanged`, `Issue: …`.
 */
export function parseImportReport(text: string, simulated: boolean): ImportReport {
  const summary = { issues: 0, warnings: 0, created: 0, updated: 0, unchanged: 0 };
  const messages: string[] = [];
  const tableLines: string[] = [];
  let sawSummary = false;

  const counters: Record<string, keyof typeof summary> = {
    Issues: "issues",
    Warnings: "warnings",
    Created: "created",
    Updated: "updated",
    Unchanged: "unchanged",
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const remark = line.slice(1).trim();
      const counter = /^(Issues|Warnings|Created|Updated|Unchanged):\s*(\d+)$/.exec(remark);
      if (counter) {
        summary[counters[counter[1]!]!] = Number(counter[2]);
        sawSummary = true;
      } else if (
        // The echo of the request (webservices/import.php:345-624, 719);
        // everything else -- warnings, refusals -- is worth showing.
        !/^(Output format|Class|Separator|Qualifier|Charset Encoding|Date and time format|Date format|Localize|Data Size|Data Lines|Simulate|Columns|Reconciliation Keys|Change tracking comment):/.test(remark)
      ) {
        messages.push(remark);
      }
      continue;
    }
    tableLines.push(line);
  }

  // No counts means iTop never reached the load: bad credentials, an unknown
  // class or column. Its text says which.
  if (!sawSummary) {
    const reason = [...messages, ...tableLines].join(" ").trim();
    throw new AppError("bad_request", `iTop did not import the file: ${reason || "no report was returned."}`);
  }

  const [header, ...body] = tableLines;
  const rows = body.map((line) => {
    // Cells are `"`-qualified when they hold the separator.
    const cells = parseCsv(line, ";", '"')[0] ?? [];
    const status = cells[1] ?? "";
    return {
      line: Number(cells[0]) || 0,
      kind: rowKind(status),
      status,
      class: cells[2] ?? "",
      id: cells[3] ?? "",
      cells: cells.slice(4),
    };
  });

  return {
    simulated,
    summary,
    messages,
    columns: header ? (parseCsv(header, ";", '"')[0] ?? []).slice(4) : [],
    rows,
  };
}

function rowKind(status: string): ImportRowKind {
  const s = status.trim().toLowerCase();
  if (s.startsWith("issue")) return "error";
  if (s.startsWith("created")) return "created";
  if (s.startsWith("updated")) return "updated";
  if (s.startsWith("unchanged")) return "unchanged";
  return "other";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
