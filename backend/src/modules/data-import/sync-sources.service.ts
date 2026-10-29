import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";
import { writeCsv } from "../../platform/transfer/csv.js";
import { TRANSFER_TIMEOUT_MS } from "../../platform/transfer/transfer.service.js";
import type { CmdbSchema } from "../../schema/load.js";
import type {
  DeletePolicy,
  ReconciliationPolicy,
  SyncAttribute,
  SyncLog,
  SyncLogSummary,
  SyncRunRequest,
  SyncRunResult,
  SyncSource,
  SyncSourceDetail,
  SyncSourceInput,
  SyncStatus,
} from "./data-import.types.js";
import { assertImportClass } from "./import-plan.js";
import { MAX_IMPORT_ROWS } from "./data-import.service.js";

const SOURCE_FIELDS = [
  "id",
  "name",
  "description",
  "status",
  "scope_class",
  "reconciliation_policy",
  "action_on_zero",
  "action_on_one",
  "action_on_multiple",
  "delete_policy",
  "delete_policy_update",
  "delete_policy_retention",
  "full_load_periodicity",
  "user_id_friendlyname",
].join(",");

const LOG_SUMMARY_FIELDS = [
  "id",
  "sync_source_id",
  "start_date",
  "end_date",
  "status",
  "stats_nb_replica_seen",
  "stats_nb_replica_total",
  "stats_nb_obj_created",
  "stats_nb_obj_updated",
  "stats_nb_obj_new_updated",
  "stats_nb_obj_deleted",
  "stats_nb_obj_obsoleted",
  "stats_nb_obj_created_errors",
  "stats_nb_obj_updated_errors",
  "stats_nb_obj_deleted_errors",
  "stats_nb_obj_obsoleted_errors",
  "stats_nb_replica_reconciled_errors",
  "last_error",
].join(",");

/** Logs shown with a source. */
const RECENT_LOGS = 10;

/**
 * Recurring feeds, kept as iTop's own Data Synchro: a SynchroDataSource per
 * feed (target class, how rows find their record, what happens to records
 * that vanish from the feed), a SynchroLog per run. iTop's synchro does the
 * matching, the replicas and the deletion policy exactly as it does for any
 * other collector, so a feed defined here and one fed by a Combodo
 * collector behave the same.
 *
 * REST covers defining a source (core/create builds its attributes and its
 * data table) and reading its logs. Loading a file and running the synchro
 * is synchro/synchro_import.php, iTop's own HTTP entry point for collectors,
 * called the way the import calls import.php. Scheduling stays with the
 * feed's sender (a collector or a cron job posting the file); see
 * backend/README.md, "Data import and sync".
 *
 * Under tenancy a source spans every organisation, so the tenant guard keeps
 * sources to the platform operator (SynchroDataSource is not a published
 * class, and the synchro script is refused to tenants).
 */
export class SyncSourcesService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
  ) {}

  async list(): Promise<SyncSource[]> {
    this.assertPlatform();
    const result = await this.client.call("core/get", {
      class: "SynchroDataSource",
      key: "SELECT SynchroDataSource",
      output_fields: SOURCE_FIELDS,
    });
    const sources = normalizeObjects(result.objects).map(toSource);
    const latest = await this.latestLogs(sources.map((s) => s.id));
    return sources
      .map((s) => (latest.has(s.id) ? { ...s, lastRun: latest.get(s.id)! } : s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: number): Promise<SyncSourceDetail> {
    this.assertPlatform();
    const source = await this.source(id);
    const [attributes, logs] = await Promise.all([this.attributes(id), this.logs(id, RECENT_LOGS)]);
    return { ...source, ...(logs[0] ? { lastRun: logs[0] } : {}), attributes, logs };
  }

  async log(sourceId: number, logId: number): Promise<SyncLog> {
    this.assertPlatform();
    const result = await this.client.call("core/get", {
      class: "SynchroLog",
      key: `SELECT SynchroLog WHERE id = ${logId} AND sync_source_id = ${sourceId}`,
      output_fields: `${LOG_SUMMARY_FIELDS},traces`,
    });
    const log = normalizeObjects(result.objects)[0];
    if (!log) throw notFound("No such run for this source.");
    return { ...toLog(log), traces: str(log.fields["traces"]) };
  }

  /**
   * Creates the source. iTop adds a SynchroAttribute for every writable
   * field and the source's data table; the attributes are then set from
   * the input: the feed's columns are written (locked to the feed), the rest
   * left alone, the keys are what rows are matched on.
   */
  async create(input: SyncSourceInput): Promise<SyncSourceDetail> {
    this.assertPlatform();
    const caller = currentCaller();
    const fields = this.sourceFields(input);
    const result = await this.client.call("core/create", {
      class: "SynchroDataSource",
      fields: { ...fields, scope_class: this.targetClass(input.targetClass), ...(caller?.userId ? { user_id: caller.userId } : {}) },
      output_fields: "id",
      comment: `Sync source defined by ${caller?.login ?? "an administrator"}`,
    });
    const id = normalizeObjects(result.objects)[0]?.id;
    if (!id) throw new AppError("upstream_error", "iTop reported success but returned no source.");
    try {
      await this.setAttributes(id, input);
    } catch (error) {
      // A half-made source would run with iTop's default keys: undo it.
      await this.client.callRaw("core/delete", { class: "SynchroDataSource", key: id, comment: "Sync source set-up failed" });
      throw error;
    }
    return this.get(id);
  }

  async update(id: number, input: SyncSourceInput): Promise<SyncSourceDetail> {
    this.assertPlatform();
    const source = await this.source(id);
    if (this.targetClass(input.targetClass) !== source.targetClass) {
      throw badRequest("A source's target class cannot change; define a new source instead.");
    }
    await this.client.call("core/update", {
      class: "SynchroDataSource",
      key: id,
      fields: this.sourceFields(input),
      output_fields: "id",
      comment: `Sync source changed by ${currentCaller()?.login ?? "an administrator"}`,
    });
    await this.setAttributes(id, input);
    return this.get(id);
  }

  /** Deletes the source, its data table and replicas. The records it made stay. */
  async remove(id: number): Promise<void> {
    this.assertPlatform();
    await this.source(id);
    await this.client.call("core/delete", {
      class: "SynchroDataSource",
      key: id,
      comment: `Sync source deleted by ${currentCaller()?.login ?? "an administrator"}`,
    });
  }

  /**
   * Loads a file into the source and synchronizes, through iTop's
   * synchro_import.php. With `simulate`, iTop runs it all inside a
   * transaction and rolls it back: the counts are what a real run would do.
   */
  async run(id: number, request: SyncRunRequest): Promise<SyncRunResult> {
    this.assertPlatform();
    const source = await this.source(id);
    if (request.rows.length === 0) throw badRequest("The file has no rows.");
    if (request.rows.length > MAX_IMPORT_ROWS * 5) {
      throw badRequest(`One run takes at most ${(MAX_IMPORT_ROWS * 5).toLocaleString("en")} rows.`);
    }
    const attributes = await this.attributes(id);
    const known = new Set(["primary_key", ...attributes.map((a) => a.attcode)]);
    const keep: { index: number; column: string }[] = [];
    request.columns.forEach((column, index) => {
      if (column === null) return;
      if (!known.has(column)) throw badRequest(`"${column}" is not a column of this source.`);
      if (keep.some((k) => k.column === column)) throw badRequest(`Two columns fill "${column}".`);
      keep.push({ index, column });
    });
    if (!keep.some((k) => k.column === "primary_key")) {
      throw badRequest("Map one column to primary_key: the feed's own id for each row, which iTop keeps to recognise it next time.");
    }
    const csv = writeCsv(
      [keep.map((k) => k.column), ...request.rows.map((cells) => keep.map((k) => (cells[k.index] ?? "").trim()))],
      ",",
      '"',
    );

    const before = (await this.logs(id, 1))[0]?.id ?? 0;
    const response = await this.client.postScript(
      "synchro/synchro_import.php",
      {
        data_source_id: String(id),
        csvdata: csv,
        synchronize: "1",
        simulate: request.simulate ? "1" : "0",
        output: "details",
        charset: "UTF-8",
        separator: ",",
        qualifier: '"',
        date_format: "Y-m-d H:i:s",
        no_stop_on_import_error: "1",
        comment: `Sync run of ${source.name} by ${currentCaller()?.login ?? "an administrator"}`,
      },
      { timeoutMs: TRANSFER_TIMEOUT_MS },
    );
    const parsed = parseSynchroOutput(await response.text());
    const latest = request.simulate ? undefined : (await this.logs(id, 1))[0];
    return {
      simulated: request.simulate,
      counts: parsed.counts,
      messages: parsed.messages,
      ...(latest && latest.id !== before ? { log: latest } : {}),
    };
  }

  // -------------------------------------------------------------------------

  private assertPlatform(): void {
    if (currentTenant()) {
      throw new AppError("forbidden", "Sync sources span every organisation; the platform operator manages them.");
    }
  }

  private targetClass(name: string): string {
    return assertImportClass(this.schema, name).name;
  }

  private sourceFields(input: SyncSourceInput): Record<string, unknown> {
    const policy: ReconciliationPolicy = input.reconciliationPolicy ?? "use_attributes";
    const deletePolicy: DeletePolicy = input.deletePolicy ?? "ignore";
    if ((deletePolicy === "update" || deletePolicy === "update_then_delete") && !input.deletePolicyUpdate?.trim()) {
      throw badRequest('Say what to set on a record that leaves the feed, e.g. "status:obsolete".');
    }
    if (deletePolicy === "update_then_delete" && !(input.deletePolicyRetention && input.deletePolicyRetention > 0)) {
      throw badRequest("Say how long a record that left the feed is kept before it is deleted.");
    }
    if (policy === "use_attributes" && input.keys.length === 0) {
      throw badRequest("Pick at least one field the feed's rows are matched on.");
    }
    return {
      name: input.name.trim(),
      description: input.description ?? "",
      status: input.status ?? "implementation",
      reconciliation_policy: policy,
      action_on_zero: input.actionOnZero ?? "create",
      action_on_one: input.actionOnOne ?? "update",
      action_on_multiple: input.actionOnMultiple ?? "error",
      delete_policy: deletePolicy,
      delete_policy_update: input.deletePolicyUpdate ?? "",
      delete_policy_retention: input.deletePolicyRetention ?? 0,
      full_load_periodicity: input.fullLoadPeriodicity ?? 0,
    };
  }

  /**
   * Sets each SynchroAttribute: written when the feed has the column, a key
   * when listed, a reference matched on the field given in `lookups`. Keys
   * are switched on before the others are switched off, so the source never
   * passes through "no key at all", which iTop refuses.
   */
  private async setAttributes(id: number, input: SyncSourceInput): Promise<void> {
    const attributes = await this.attributes(id);
    const codes = new Set(attributes.map((a) => a.attcode));
    for (const code of [...input.columns, ...input.keys, ...Object.keys(input.lookups ?? {})]) {
      if (!codes.has(code)) throw badRequest(`"${code}" is not a field this source can write.`);
    }
    for (const key of input.keys) {
      if (!input.columns.includes(key)) throw badRequest(`The key "${key}" must be one of the feed's columns.`);
    }
    const desired = (a: SyncAttribute): Record<string, unknown> => {
      const fields: Record<string, unknown> = {
        update: input.columns.includes(a.attcode) ? 1 : 0,
        reconcile: input.keys.includes(a.attcode) ? 1 : 0,
      };
      if (a.lookup !== undefined) fields["reconciliation_attcode"] = input.lookups?.[a.attcode] ?? "";
      return fields;
    };
    const changed = (a: SyncAttribute, f: Record<string, unknown>) =>
      Number(a.update) !== f["update"] ||
      Number(a.reconcile) !== f["reconcile"] ||
      (a.lookup !== undefined && a.lookup !== f["reconciliation_attcode"]);
    const ordered = [...attributes].sort((a, b) => Number(input.keys.includes(b.attcode)) - Number(input.keys.includes(a.attcode)));
    for (const a of ordered) {
      const fields = desired(a);
      if (!changed(a, fields)) continue;
      await this.client.call("core/update", {
        class: a.lookup !== undefined ? "SynchroAttExtKey" : "SynchroAttribute",
        key: `SELECT SynchroAttribute WHERE sync_source_id = ${id} AND attcode = ${quoteString(a.attcode)}`,
        fields,
        output_fields: "id",
        comment: "Sync source attributes",
      });
    }
  }

  private async source(id: number): Promise<SyncSource> {
    const result = await this.client.call("core/get", {
      class: "SynchroDataSource",
      key: id,
      output_fields: SOURCE_FIELDS,
    });
    const object = normalizeObjects(result.objects)[0];
    if (!object) throw notFound(`Sync source ${id} was not found.`);
    return toSource(object);
  }

  private async attributes(id: number): Promise<SyncAttribute[]> {
    const [all, extKeys] = await Promise.all([
      this.client.call("core/get", {
        class: "SynchroAttribute",
        key: `SELECT SynchroAttribute WHERE sync_source_id = ${id}`,
        output_fields: "attcode,update,reconcile,update_policy",
      }),
      this.client.call("core/get", {
        class: "SynchroAttExtKey",
        key: `SELECT SynchroAttExtKey WHERE sync_source_id = ${id}`,
        output_fields: "attcode,reconciliation_attcode",
      }),
    ]);
    const lookups = new Map(normalizeObjects(extKeys.objects).map((o) => [str(o.fields["attcode"]), str(o.fields["reconciliation_attcode"])]));
    return normalizeObjects(all.objects)
      .map((o) => {
        const attcode = str(o.fields["attcode"]);
        const attribute: SyncAttribute = {
          attcode,
          update: bool(o.fields["update"]),
          reconcile: bool(o.fields["reconcile"]),
          updatePolicy: str(o.fields["update_policy"]),
        };
        if (lookups.has(attcode)) attribute.lookup = lookups.get(attcode)!;
        return attribute;
      })
      .sort((a, b) => a.attcode.localeCompare(b.attcode));
  }

  /** The newest runs of one source. REST cannot sort, so ids are read first. */
  private async logs(sourceId: number, count: number): Promise<SyncLogSummary[]> {
    const ids = await this.client.call("core/get", {
      class: "SynchroLog",
      key: `SELECT SynchroLog WHERE sync_source_id = ${sourceId}`,
      output_fields: "id",
    });
    const newest = normalizeObjects(ids.objects)
      .map((o) => o.id)
      .sort((a, b) => b - a)
      .slice(0, count);
    if (newest.length === 0) return [];
    const result = await this.client.call("core/get", {
      class: "SynchroLog",
      key: `SELECT SynchroLog WHERE id IN (${newest.join(",")})`,
      output_fields: LOG_SUMMARY_FIELDS,
    });
    return normalizeObjects(result.objects)
      .map(toLog)
      .sort((a, b) => b.id - a.id);
  }

  private async latestLogs(sourceIds: number[]): Promise<Map<number, SyncLogSummary>> {
    const out = new Map<number, SyncLogSummary>();
    await Promise.all(
      sourceIds.map(async (id) => {
        const [latest] = await this.logs(id, 1);
        if (latest) out.set(id, latest);
      }),
    );
    return out;
  }
}

/**
 * Reads synchro_import.php's text answer: `#`-prefixed remarks, among them
 * "Key: number" counts for the load and the synchronization, and plain
 * lines for each row's remark or an error.
 */
export function parseSynchroOutput(text: string): { counts: Record<string, number>; messages: string[] } {
  const counts: Record<string, number> = {};
  const messages: string[] = [];
  const echo =
    /^(Output format|Simulate|Change tracking comment|Data Source|Synchronize|Class|Separator|Qualifier|Charset Encoding|Date and time format|Date only format|Columns|Data Size|Data Lines|\s*Import phase summary|\s*Synchronization phase( summary)?)\b/;
  for (const raw of pageText(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const remark = line.slice(1).trim();
      // "Objects created: 3 (0 warnings)"
      const count = /^([A-Za-z][^:]*):\s*(\d+)(?:\s*\((\d+) warnings\))?$/.exec(remark);
      if (count) {
        counts[count[1]!.trim()] = Number(count[2]);
        if (count[3] !== undefined && Number(count[3]) > 0) counts[`${count[1]!.trim()} warnings`] = Number(count[3]);
        continue;
      }
      if (remark === "" || /^-+$/.test(remark) || echo.test(remark) || /^No traces\./.test(remark)) continue;
      messages.push(remark);
      continue;
    }
    // "3: New entry, reconciliation: ..." is noise for a person; errors are not.
    if (/^\d+: (New entry|Update entry)/.test(line)) continue;
    messages.push(line);
  }
  if (Object.keys(counts).length === 0) {
    throw new AppError("bad_request", `iTop did not run the sync: ${messages.join(" ").slice(0, 400) || "no report was returned."}`);
  }
  return { counts, messages };
}

/**
 * Over HTTP the script answers with an HTML page (CLILikeWebPage): each
 * remark is "#text<br/>" inside the page's layout. Back to plain lines.
 */
function pageText(text: string): string {
  if (!/<br\s*\/?>|<html/i.test(text)) return text;
  return text
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[e.toLowerCase()] ?? "";
    });
}

function toSource(o: FlatObject): SyncSource {
  const f = o.fields;
  return {
    id: o.id,
    name: str(f["name"]),
    description: str(f["description"]),
    status: str(f["status"]) as SyncStatus,
    targetClass: str(f["scope_class"]),
    reconciliationPolicy: str(f["reconciliation_policy"]) as ReconciliationPolicy,
    actionOnZero: str(f["action_on_zero"]) as SyncSource["actionOnZero"],
    actionOnOne: str(f["action_on_one"]) as SyncSource["actionOnOne"],
    actionOnMultiple: str(f["action_on_multiple"]) as SyncSource["actionOnMultiple"],
    deletePolicy: str(f["delete_policy"]) as DeletePolicy,
    deletePolicyUpdate: str(f["delete_policy_update"]),
    deletePolicyRetention: Number(f["delete_policy_retention"] ?? 0) || 0,
    fullLoadPeriodicity: Number(f["full_load_periodicity"] ?? 0) || 0,
    user: str(f["user_id_friendlyname"]),
  };
}

function toLog(o: FlatObject): SyncLogSummary {
  const f = o.fields;
  const n = (code: string) => Number(f[code] ?? 0) || 0;
  return {
    id: o.id,
    startDate: str(f["start_date"]),
    endDate: str(f["end_date"]),
    status: str(f["status"]),
    replicasSeen: n("stats_nb_replica_seen"),
    replicasTotal: n("stats_nb_replica_total"),
    created: n("stats_nb_obj_created"),
    updated: n("stats_nb_obj_updated") + n("stats_nb_obj_new_updated"),
    deleted: n("stats_nb_obj_deleted"),
    obsoleted: n("stats_nb_obj_obsoleted"),
    errors:
      n("stats_nb_obj_created_errors") +
      n("stats_nb_obj_updated_errors") +
      n("stats_nb_obj_deleted_errors") +
      n("stats_nb_obj_obsoleted_errors") +
      n("stats_nb_replica_reconciled_errors"),
    lastError: str(f["last_error"]),
  };
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}
