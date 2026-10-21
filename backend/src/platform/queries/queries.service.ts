import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, type Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { ItopCode } from "../../itop/codes.js";
import { cleanMessage, normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { str } from "../../shared/ticket-mapping.js";
import { selectedClass } from "../admin/audit.service.js";
import { conditionsToFilter, filterToConditions } from "../admin/conditions.js";
import { criterionKind, type Criterion } from "../objects/criteria.js";
import type { ListResult, ObjectsService } from "../objects/objects.service.js";
import type { ExportFile, ExportFormat, TransferService } from "../transfer/transfer.service.js";

/**
 * Saved queries: iTop's query phrasebook (QueryOQL) and its "Run queries"
 * page, without iTop.
 *
 * A query is kept in iTop as OQL, as iTop keeps it. Here it is defined one of
 * two ways: a record type plus conditions, in the advanced-search vocabulary
 * (criteria.ts, written and read back by conditions.ts, as notification rules
 * and the audit do), or -- administrators only -- as OQL, which iTop checks
 * by running it before anything is saved.
 *
 * Who may do what:
 * - Reading the phrasebook is done with the service account: iTop gives only
 *   administrators rights on QueryOQL, and staff need the list to run from.
 *   OQL never leaves this file for anyone but an administrator.
 * - Running and exporting always call iTop as the caller, so iTop applies
 *   their own profiles and organisations to the records returned. A query is
 *   never run as the service account.
 * - Administrators write as themselves, OQL included. Other staff may save
 *   condition queries and change or delete only their own; those writes go
 *   through the service account (iTop would refuse them), so this service is
 *   the access control, and what it writes is OQL it built itself.
 */

/** Parameters iTop's REST API does not fill in, which the BFF binds from the caller. */
const CALLER_PARAMETERS = ["current_contact_id", "current_user_id"] as const;

const OUTPUT_FIELDS = "name,description,oql,fields,is_template,owner_id,owner_id_friendlyname";

export interface SavedQueryDto {
  id: number;
  name: string;
  description: string;
  /** The kind of record it lists; "" when the platform has no screens for it. */
  recordType: string;
  recordTypeLabel: string;
  /**
   * `conditions`: a record type and conditions, editable by anyone allowed to.
   * `oql`: only expressible as OQL (a join, a union, a part set up in iTop);
   * administrators edit it as OQL, everyone may still run it.
   */
  mode: "conditions" | "oql";
  conditions: Criterion[];
  /** Names of the records key conditions point at, keyed "field:id" (single query only). */
  valueLabels: Record<string, string>;
  /** Columns to show and export; empty for the record type's own list columns. */
  columns: string[];
  /** The query itself, for administrators only. */
  oql?: string;
  /** Values the query needs that only exist where iTop uses it (`this->agent_id`). */
  parameters: string[];
  /** False when it needs such values, or lists something the platform cannot show. */
  runnable: boolean;
  /** One of iTop's predefined queries (used by notifications). */
  template: boolean;
  owner: { id: number; name: string } | null;
  /** May the caller change or delete it. */
  canEdit: boolean;
}

export interface QueryInput {
  name: string;
  description?: string;
  /** Conditions mode: the kind of record and the conditions, ANDed. */
  recordType?: string;
  conditions?: Criterion[];
  /** OQL mode, administrators only. */
  oql?: string;
  columns?: string[];
}

export interface QueryResult extends ListResult {
  recordType: string;
  columns: string[];
}

export interface RunOptions {
  page: number;
  limit: number;
  fields?: string;
  sort?: string;
  order?: "asc" | "desc";
}

/** Walks OQL outside quoted literals, calling `visit` for each `:parameter`. */
function scanParameters(oql: string, visit: (name: string, start: number, end: number) => void): void {
  let quote: string | null = null;
  for (let i = 0; i < oql.length; i++) {
    const c = oql[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === ":") {
      const m = /^:([A-Za-z_]\w*(?:->[A-Za-z_]\w*)?)/.exec(oql.slice(i));
      if (m) {
        visit(m[1]!, i, i + m[0].length);
        i += m[0].length - 1;
      }
    }
  }
}

/** The `:parameters` a query needs, other than the caller's own ids. */
export function queryParameters(oql: string): string[] {
  const found = new Set<string>();
  scanParameters(oql, (name) => {
    if (!(CALLER_PARAMETERS as readonly string[]).includes(name)) found.add(name);
  });
  return [...found];
}

/** Binds `:current_contact_id` and `:current_user_id` to the caller, as numbers. */
export function bindCallerParameters(oql: string, caller: Pick<Caller, "contactId" | "userId"> | undefined): string {
  const parts: string[] = [];
  let last = 0;
  scanParameters(oql, (name, start, end) => {
    const value =
      name === "current_contact_id" ? (caller?.contactId ?? 0) : name === "current_user_id" ? (caller?.userId ?? 0) : null;
    if (value === null) return;
    parts.push(oql.slice(last, start), String(Math.trunc(Number(value)) || 0));
    last = end;
  });
  parts.push(oql.slice(last));
  return parts.join("");
}

/**
 * iTop's `fields` ("name,org_id" or, for an aliased query, "C.name") as
 * attribute codes of the class; codes the class does not have are dropped.
 */
export function parseColumns(info: ClassInfo | undefined, fields: string): string[] {
  if (!info) return [];
  const codes = fields
    .split(",")
    .map((f) => f.trim().replace(/^[A-Za-z_]\w*\./, ""))
    .filter((code) => code && code !== "id" && code !== "friendlyname" && info.fields[code]);
  return [...new Set(codes)];
}

export class QueriesService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly objects: ObjectsService,
    private readonly transfer: TransferService,
  ) {}

  private caller(): Caller | undefined {
    return currentCaller();
  }

  private isAdmin(): boolean {
    const caller = this.caller();
    // Without sign-in (development), the BFF acts as its own administrator.
    return caller ? caller.isAdmin : true;
  }

  private label(cls: string): string {
    const label = this.schema.get(cls)?.labels.class;
    return label && !label.includes("%") ? label : cls;
  }

  /** The phrasebook, read with the service account (see above). */
  private async rows(key: string | number): Promise<FlatObject[]> {
    const result = await this.client.call(
      "core/get",
      { class: "QueryOQL", key, output_fields: OUTPUT_FIELDS },
      { asService: true },
    );
    return normalizeObjects(result.objects);
  }

  private async row(id: number): Promise<FlatObject> {
    const [row] = await this.rows(id);
    if (!row) throw notFound(`No saved query ${id}.`);
    return row;
  }

  private toDto(row: FlatObject): SavedQueryDto {
    const f = row.fields;
    const oql = str(f["oql"]).trim();
    const selected = selectedClass(oql) ?? "";
    const info = this.schema.get(selected);
    const parsed = info ? filterToConditions(info, oql) : { conditions: [], kept: [oql] };
    const parameters = queryParameters(oql);
    const ownerId = Number(f["owner_id"]) || 0;
    const template = str(f["is_template"]) === "yes";
    const mode = info && parsed.kept.length === 0 && parameters.length === 0 ? "conditions" : "oql";
    const caller = this.caller();
    const canEdit = this.isAdmin() || (!template && mode === "conditions" && ownerId > 0 && ownerId === caller?.contactId);
    return {
      id: row.id,
      name: str(f["name"]),
      // The name standing in for a missing description (see fields()) is not one.
      description: str(f["description"]) === str(f["name"]) ? "" : str(f["description"]),
      recordType: info ? info.name : "",
      recordTypeLabel: info ? this.label(info.name) : selected,
      mode,
      conditions: mode === "conditions" ? parsed.conditions : [],
      valueLabels: {},
      columns: parseColumns(info, str(f["fields"])),
      ...(this.isAdmin() ? { oql } : {}),
      parameters,
      runnable: Boolean(info) && parameters.length === 0,
      template,
      owner: ownerId > 0 ? { id: ownerId, name: str(f["owner_id_friendlyname"]) } : null,
      canEdit,
    };
  }

  async list(): Promise<SavedQueryDto[]> {
    return (await this.rows("SELECT QueryOQL")).map((r) => this.toDto(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One query, with the names of the records its conditions point at (read as the caller). */
  async get(id: number): Promise<SavedQueryDto> {
    const dto = this.toDto(await this.row(id));
    return { ...dto, valueLabels: await this.valueLabels(this.schema.get(dto.recordType), dto.conditions) };
  }

  private async valueLabels(info: ClassInfo | undefined, conditions: Criterion[]): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    await Promise.all(
      conditions.map(async (c) => {
        const target = info?.fields[c.field]?.target;
        const ids = (c.values ?? []).map(String).filter((v) => /^\d+$/.test(v));
        if (!target || !ids.length) return;
        const result = await this.client.call("core/get", {
          class: target,
          key: `SELECT ${target} WHERE id IN (${ids.join(",")})`,
          output_fields: "friendlyname",
        });
        const names = new Map(normalizeObjects(result.objects).map((r) => [String(r.id), str(r.fields["friendlyname"])]));
        for (const id of ids) labels[`${c.field}:${id}`] = names.get(id) || `#${id}`;
      }),
    );
    return labels;
  }

  /** What the editor may offer: every record type the platform shows. */
  options(): { recordTypes: Array<{ name: string; label: string }> } {
    return {
      recordTypes: this.schema
        .list()
        .map((c) => ({ name: c.name, label: this.label(c.name) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  private requireClass(name: string | undefined): ClassInfo {
    const info = name ? this.schema.get(name) : undefined;
    if (!info) throw badRequest(`Unknown kind of record "${name ?? ""}".`);
    return info;
  }

  private checkColumns(info: ClassInfo, columns: string[] | undefined): string[] {
    const out: string[] = [];
    for (const code of columns ?? []) {
      const field = info.fields[code];
      if (!field || field.ui === "related" || field.ui === "ignored") {
        throw badRequest(`${this.label(info.name)} has no column "${code}".`);
      }
      if (!out.includes(code)) out.push(code);
    }
    return out;
  }

  /**
   * The OQL and record type an input stands for, checked. OQL from an
   * administrator is run by iTop (one row, as the administrator) so a query
   * iTop cannot run is never saved, and its own error is shown instead.
   */
  private async definition(input: QueryInput): Promise<{ oql: string; info: ClassInfo; columns: string[] }> {
    if (input.oql !== undefined && input.oql.trim() !== "") {
      if (!this.isAdmin()) throw new AppError("forbidden", "Only administrators can write a query as OQL.");
      const oql = input.oql.trim();
      const cls = selectedClass(oql);
      if (!cls) throw badRequest("A query starts with SELECT and the kind of record it lists.");
      const info = this.schema.get(cls);
      if (!info) throw badRequest(`This query lists ${cls}, which the platform has no screens for.`);
      const parameters = queryParameters(oql);
      if (!parameters.length) await this.check(info, oql);
      return { oql, info, columns: this.checkColumns(info, input.columns) };
    }
    const info = this.requireClass(input.recordType);
    for (const c of input.conditions ?? []) {
      const field = info.fields[c.field];
      if (!field) throw badRequest(`${this.label(info.name)} has no field "${c.field}".`);
      // A fixed date cannot be read back from the stored query as a condition.
      if (criterionKind(field) === "date") throw badRequest("Dates cannot be used in saved query conditions.");
    }
    const oql = conditionsToFilter(info, input.conditions ?? []) || `SELECT ${info.name}`;
    return { oql, info, columns: this.checkColumns(info, input.columns) };
  }

  /** Runs `oql` for one row, as the caller; iTop's refusal becomes a 400 with its own words. */
  private async check(info: ClassInfo, oql: string): Promise<void> {
    const result = await this.client.callRaw("core/get", {
      class: info.name,
      key: bindCallerParameters(oql, this.caller()),
      output_fields: "id",
      limit: 1,
      page: 1,
    });
    if (result.code !== ItopCode.OK) {
      throw badRequest(`iTop cannot run this query: ${cleanMessage(result.message) || "no reason given."}`);
    }
  }

  private fields(input: QueryInput, def: { oql: string; columns: string[] }) {
    return {
      name: input.name.trim(),
      // iTop refuses a query without a description: the name stands in for one.
      description: (input.description ?? "").trim() || input.name.trim(),
      oql: def.oql,
      fields: def.columns.join(","),
    };
  }

  /** Writes as the administrator; for other staff, as the service account (see above). */
  private writeOptions() {
    return { asService: !this.isAdmin() };
  }

  private comment(verb: string): string {
    const caller = this.caller();
    return `Saved query ${verb} in the platform${caller && !caller.isAdmin ? ` by ${caller.login}` : ""}`;
  }

  async create(input: QueryInput): Promise<SavedQueryDto> {
    if (!input.name.trim()) throw badRequest("Give the query a name.");
    const def = await this.definition(input);
    const caller = this.caller();
    const created = await this.client.call(
      "core/create",
      {
        class: "QueryOQL",
        fields: {
          ...this.fields(input, def),
          is_template: "no",
          ...(caller?.contactId ? { owner_id: caller.contactId } : {}),
        },
        output_fields: "id",
        comment: this.comment("created"),
      },
      this.writeOptions(),
    );
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no query.");
    return this.get(row.id);
  }

  /** The query, if the caller may change it. */
  private async editable(id: number): Promise<SavedQueryDto> {
    const dto = this.toDto(await this.row(id));
    if (!dto.canEdit) {
      throw new AppError(
        "forbidden",
        dto.mode === "oql" || dto.template
          ? "Only administrators can change this query."
          : "Only its owner or an administrator can change this query.",
      );
    }
    return dto;
  }

  async update(id: number, input: QueryInput): Promise<SavedQueryDto> {
    if (!input.name.trim()) throw badRequest("Give the query a name.");
    await this.editable(id);
    const def = await this.definition(input);
    await this.client.call(
      "core/update",
      { class: "QueryOQL", key: id, fields: this.fields(input, def), output_fields: "id", comment: this.comment("edited") },
      this.writeOptions(),
    );
    return this.get(id);
  }

  async remove(id: number): Promise<void> {
    await this.editable(id);
    await this.client.call(
      "core/delete",
      { class: "QueryOQL", key: id, comment: this.comment("deleted") },
      this.writeOptions(),
    );
  }

  /** The OQL a saved query runs, for the caller, refusing what cannot run here. */
  private async runnable(id: number): Promise<{ info: ClassInfo; oql: string; columns: string[] }> {
    const row = await this.row(id);
    const oql = str(row.fields["oql"]).trim();
    const parameters = queryParameters(oql);
    if (parameters.length) {
      throw badRequest(
        `This query needs values that only exist where iTop uses it (${parameters.join(", ")}), ` +
          "for example in a notification, so it cannot be run on its own.",
      );
    }
    const cls = selectedClass(oql);
    const info = cls ? this.schema.get(cls) : undefined;
    if (!info) throw badRequest(`This query lists ${cls ?? "something"}, which the platform has no screens for.`);
    return { info, oql: bindCallerParameters(oql, this.caller()), columns: parseColumns(info, str(row.fields["fields"])) };
  }

  private async page(info: ClassInfo, oql: string, columns: string[], options: RunOptions): Promise<QueryResult> {
    try {
      const result = await this.objects.list(info.name, {
        page: options.page,
        limit: options.limit,
        oql,
        // Without a choice, every column: whichever the screen then shows is there.
        fields: options.fields ?? "full",
        ...(options.sort !== undefined ? { sort: options.sort } : {}),
        ...(options.order !== undefined ? { order: options.order } : {}),
      });
      return { ...result, recordType: info.name, columns };
    } catch (error) {
      // iTop refusing the query itself is the query's fault, worth its words.
      if (error instanceof AppError && error.itopCode !== undefined && error.status >= 500) {
        throw badRequest(`iTop cannot run this query: ${error.message}`);
      }
      throw error;
    }
  }

  /** A page of a saved query's records, read as the caller. */
  async run(id: number, options: RunOptions): Promise<QueryResult> {
    const { info, oql, columns } = await this.runnable(id);
    return this.page(info, oql, columns, options);
  }

  /** Runs a query before (or without) saving it: iTop's "Run queries". */
  async runDraft(input: QueryInput, options: RunOptions): Promise<QueryResult> {
    const def = await this.definition(input);
    const parameters = queryParameters(def.oql);
    if (parameters.length) {
      throw badRequest(`This query needs values that only exist where iTop uses it (${parameters.join(", ")}).`);
    }
    return this.page(def.info, bindCallerParameters(def.oql, this.caller()), def.columns, options);
  }

  /** A saved query's records as a file, rendered by iTop's exporter as the caller. */
  async export(id: number, format: ExportFormat, fields?: string): Promise<ExportFile> {
    const { info, oql } = await this.runnable(id);
    return this.transfer.export(info.name, oql, format, fields);
  }
}
