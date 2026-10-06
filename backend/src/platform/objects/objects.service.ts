import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { DELETE_CODE_LABELS, ItopCode } from "../../itop/codes.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { assertIdentifier, buildOql } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { validateWrite } from "../../shared/write-validation.js";

/**
 * Upper bound on rows the BFF will pull in order to sort.
 *
 * iTop cannot sort: OQL has no ORDER BY production and core/get hardcodes
 * DBObjectSet's $aOrderBy to [] (restservices.class.inc.php:556). So a sorted
 * page means fetching the whole matching set and ordering it here. That is
 * correct but not free, hence the cap and the explicit 400 past it rather than
 * silently sorting one page and calling it sorted.
 */
export const SORT_ROW_CAP = 2000;

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 50;

export type FieldSet = "summary" | "full" | "all";

export interface ListQuery {
  page: number;
  limit: number;
  /** Free-text term matched against the class's searchable string attributes. */
  q?: string;
  /** Exact-match filters, already keyed by valid attribute codes. */
  filters?: Record<string, string>;
  sort?: string;
  order?: "asc" | "desc";
  fields?: string | undefined;
  /** Include subclasses. iTop OQL is polymorphic, so this is the default. */
  oql?: string;
}

export interface ObjectDto {
  class: string;
  id: number;
  label: string;
  fields: Record<string, unknown>;
}

export interface ListResult {
  items: ObjectDto[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
  /** True when ordering was applied by the BFF rather than upstream. */
  sortedInBff: boolean;
}

export class ObjectsService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly defaultComment: string,
  ) {}

  /** Resolves a `fields` query parameter into an iTop output_fields string. */
  /**
   * Will iTop accept this attribute in `output_fields`?
   *
   * A picker whose target class is absent, and any ExternalField reached
   * through such a picker, exist in the compiled datamodel but not in iTop's
   * running model — asking for either makes iTop reject the entire request.
   */
  private isQueryable(info: ClassInfo, code: string): boolean {
    const field = info.fields[code];
    if (!field) return false;
    if (field.targetAvailable === false) return false;
    if (field.viaKey && info.fields[field.viaKey]?.targetAvailable === false) return false;
    return true;
  }

  private outputFields(info: ClassInfo, requested: string | undefined, fallback: FieldSet): string {
    const spec = (requested ?? fallback).trim();

    if (spec === "all" || spec === "*") return "*";

    if (spec === "full") {
      // Everything except link sets: a LinkedSet is a nested query per object,
      // so pulling them for a list view is the easiest way to make this slow.
      //
      // Fields whose picker target is missing from the schema are dropped too.
      // The compiled datamodel still declares them when the module defining the
      // target is not installed (Incident.parent_problem_id without Problem
      // Management), but iTop's running model has no such attribute and rejects
      // the WHOLE request with "invalid attribute code" -- breaking every read
      // of the class, not just that one field.
      const codes = [...info.writable, ...info.readonlyFields].filter((code) =>
        this.isQueryable(info, code),
      );
      return ["id", "friendlyname", ...codes].join(",");
    }

    if (spec === "summary") {
      const summary = new Set<string>(["id", "friendlyname"]);
      for (const code of ["name", "code", "status", "org_id", "organization_name"]) {
        if (info.fields[code] && info.fields[code]!.ui !== "related") summary.add(code);
      }
      return [...summary].join(",");
    }

    // Explicit comma-separated list.
    const requestedCodes = spec
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code !== "");
    if (requestedCodes.length === 0) {
      throw badRequest("`fields` must name at least one attribute.");
    }

    const out = new Set<string>(["id", "friendlyname"]);
    for (const code of requestedCodes) {
      if (code === "id" || code === "friendlyname") continue;
      assertIdentifier(code, "attribute code");
      const field = info.fields[code];
      if (!field) {
        throw badRequest(`Unknown attribute "${code}" on ${info.name}.`, {
          available: Object.keys(info.fields).sort(),
        });
      }
      if (field.ui === "ignored") {
        throw badRequest(`Attribute "${code}" on ${info.name} is not readable data.`);
      }
      out.add(code);
    }
    return [...out].join(",");
  }

  private toDto(flat: FlatObject): ObjectDto {
    const friendly = flat.fields["friendlyname"];
    const name = flat.fields["name"];
    const label =
      typeof friendly === "string" && friendly !== ""
        ? friendly
        : typeof name === "string" && name !== ""
          ? name
          : `${flat.class}::${flat.id}`;
    return { class: flat.class, id: flat.id, label, fields: flat.fields };
  }

  /** Builds the OQL for a list query, validating every identifier it embeds. */
  private listOql(info: ClassInfo, query: ListQuery): string {
    if (query.oql) {
      // A caller-supplied OQL is passed through verbatim; it is already a
      // trusted-caller feature, and iTop validates it. The class is still
      // checked so output_fields lines up.
      return query.oql;
    }

    const equals: Record<string, string | number | null> = {};
    for (const [code, raw] of Object.entries(query.filters ?? {})) {
      const field = info.fields[code];
      if (!field) {
        throw badRequest(`Unknown filter attribute "${code}" on ${info.name}.`);
      }
      if (field.ui === "related" || field.ui === "ignored") {
        throw badRequest(`Attribute "${code}" on ${info.name} cannot be used as a filter.`);
      }
      if (raw === "" || raw.toLowerCase() === "null") {
        equals[code] = null;
        continue;
      }
      if (field.ui === "picker" || field.widget === "integer") {
        if (!/^-?\d+$/.test(raw)) {
          throw badRequest(`Filter "${code}" expects a numeric value, got "${raw}".`);
        }
        equals[code] = Number.parseInt(raw, 10);
        continue;
      }
      if (field.values && !field.values.includes(raw)) {
        throw badRequest(`Filter "${code}" must be one of ${field.values.join(", ")}.`, {
          allowed: field.values,
        });
      }
      equals[code] = raw;
    }

    const built: Parameters<typeof buildOql>[0] = { class: info.name, equals };
    if (query.q && query.q.trim() !== "") {
      if (info.searchable.length === 0) {
        throw badRequest(`${info.name} has no text attributes to search.`);
      }
      built.search = { term: query.q, attributes: info.searchable };
    }
    return buildOql(built);
  }

  async list(className: string, query: ListQuery): Promise<ListResult> {
    const info = this.schema.require(className);
    const oql = this.listOql(info, query);
    const outputFields = this.outputFields(info, query.fields, "summary");

    const page = Math.max(1, query.page);
    const limit = Math.min(Math.max(1, query.limit), MAX_PAGE_SIZE);

    if (query.sort) {
      return this.listSorted(info, oql, outputFields, query, page, limit);
    }

    const result = await this.client.call("core/get", {
      class: info.name,
      key: oql,
      output_fields: outputFields,
      limit,
      page,
    });

    const items = normalizeObjects(result.objects).map((flat) => this.toDto(flat));
    const total = parseFoundCount(result.message) ?? items.length;

    return {
      items,
      page,
      limit,
      total,
      pages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
      hasMore: page * limit < total,
      sortedInBff: false,
    };
  }

  /** Sorted listing: fetch the whole set (capped), order here, then slice. */
  private async listSorted(
    info: ClassInfo,
    oql: string,
    outputFields: string,
    query: ListQuery,
    page: number,
    limit: number,
  ): Promise<ListResult> {
    const sortCode = query.sort!;
    const field = info.fields[sortCode];
    if (sortCode !== "id" && sortCode !== "friendlyname" && !field) {
      throw badRequest(`Cannot sort by unknown attribute "${sortCode}" on ${info.name}.`);
    }
    if (field && (field.ui === "related" || field.ui === "ignored")) {
      throw badRequest(`Cannot sort by "${sortCode}": it is not a scalar value.`);
    }

    // Make sure the sort key is actually fetched, otherwise every row sorts
    // equal. Deduplicated because output_fields may already name it.
    const fieldList =
      outputFields === "*"
        ? "*"
        : [...new Set([...outputFields.split(","), sortCode])].join(",");

    const result = await this.client.call("core/get", {
      class: info.name,
      key: oql,
      output_fields: fieldList,
      limit: SORT_ROW_CAP,
      page: 1,
    });

    const total = parseFoundCount(result.message) ?? 0;
    if (total > SORT_ROW_CAP) {
      throw new AppError(
        "bad_request",
        `Sorting needs the full result set, but ${total} rows match and the cap is ` +
          `${SORT_ROW_CAP}. iTop's REST API cannot sort server-side, so narrow the ` +
          `query with q/filters, or drop the sort parameter.`,
        { details: { total, cap: SORT_ROW_CAP } },
      );
    }

    const all = normalizeObjects(result.objects).map((flat) => this.toDto(flat));
    const descending = query.order === "desc";
    const sorted = [...all].sort((a, b) =>
      compareValues(sortValue(a, sortCode), sortValue(b, sortCode), descending),
    );

    const start = (page - 1) * limit;
    return {
      items: sorted.slice(start, start + limit),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: start + limit < total,
      sortedInBff: true,
    };
  }

  async get(className: string, id: number, fields?: string): Promise<ObjectDto> {
    const info = this.schema.require(className);
    const result = await this.client.call("core/get", {
      class: info.name,
      // A numeric key is handled by RestUtils::GetObjectSetFromKey as an id
      // condition, with no OQL parsing involved.
      key: id,
      output_fields: this.outputFields(info, fields, "full"),
    });

    const objects = normalizeObjects(result.objects);
    const first = objects[0];
    if (!first) {
      throw notFound(`${className}::${id} was not found.`);
    }
    return this.toDto(first);
  }

  async create(
    className: string,
    rawFields: unknown,
    options: { comment?: string; fields?: string; strict?: boolean } = {},
  ): Promise<{ object: ObjectDto; rejected: { field: string; reason: string }[] }> {
    const info = this.schema.require(className);
    if (info.abstract) {
      throw badRequest(
        `${info.name} is abstract and cannot be instantiated. Use one of its concrete subclasses.`,
      );
    }

    const validated = validateWrite(info, rawFields, {
      mode: "create",
      strict: options.strict ?? true,
    });

    const result = await this.client.call("core/create", {
      class: info.name,
      fields: validated.fields,
      output_fields: this.outputFields(info, options.fields, "full"),
      // Mandatory: RestUtils::InitTrackingComment calls GetMandatoryParam, so
      // omitting it fails the whole call.
      comment: options.comment?.trim() || this.defaultComment,
    });

    const created = normalizeObjects(result.objects)[0];
    if (!created) {
      throw new AppError("upstream_error", `iTop reported success but returned no object.`);
    }
    return { object: this.toDto(created), rejected: validated.rejected };
  }

  async update(
    className: string,
    id: number,
    rawFields: unknown,
    options: { comment?: string; fields?: string; strict?: boolean } = {},
  ): Promise<{ object: ObjectDto; rejected: { field: string; reason: string }[] }> {
    const info = this.schema.require(className);
    const validated = validateWrite(info, rawFields, {
      mode: "update",
      strict: options.strict ?? true,
    });

    const result = await this.client.call("core/update", {
      class: info.name,
      key: id,
      fields: validated.fields,
      output_fields: this.outputFields(info, options.fields, "full"),
      comment: options.comment?.trim() || this.defaultComment,
    });

    const updated = normalizeObjects(result.objects)[0];
    if (!updated) {
      throw new AppError("upstream_error", `iTop reported success but returned no object.`);
    }
    return { object: this.toDto(updated), rejected: validated.rejected };
  }

  /**
   * Deletes an object, or with simulate=true reports what deleting it would do.
   *
   * iTop answers a destructive-but-blocked delete with code UNSAFE (12) and a
   * per-object plan, so this uses callRaw to surface the plan instead of
   * collapsing it into an error.
   */
  async remove(
    className: string,
    id: number,
    options: { simulate?: boolean; comment?: string } = {},
  ): Promise<{
    simulated: boolean;
    ok: boolean;
    message: string;
    plan: { class: string; id: number; outcome: string; detail: string }[];
  }> {
    const info = this.schema.require(className);
    const simulate = options.simulate === true;

    const result = await this.client.callRaw("core/delete", {
      class: info.name,
      key: id,
      simulate,
      comment: options.comment?.trim() || this.defaultComment,
    });

    const plan = normalizeObjects(result.objects).map((flat) => ({
      class: flat.class,
      id: flat.id,
      outcome: DELETE_CODE_LABELS[flat.code] ?? `code ${flat.code}`,
      detail: flat.message,
    }));

    if (result.code === ItopCode.OK) {
      return { simulated: simulate, ok: true, message: result.message ?? "", plan };
    }

    // A simulation is informational: UNSAFE here means "this delete would need
    // explicit confirmation", which is exactly what the caller asked about.
    if (simulate) {
      return { simulated: true, ok: false, message: result.message ?? "", plan };
    }

    if (result.code === ItopCode.UNSAFE) {
      throw new AppError(
        "unsafe_operation",
        `Deleting ${className}::${id} would require deleting or updating other objects. ` +
          `Re-check with ?simulate=true and confirm those changes explicitly.`,
        { itopCode: result.code, details: { plan } },
      );
    }

    throw new AppError(
      result.code === ItopCode.UNAUTHORIZED ? "forbidden" : "upstream_error",
      result.message ?? `Deleting ${className}::${id} failed.`,
      { itopCode: result.code, details: { plan } },
    );
  }

  /** Applies a lifecycle stimulus. Only classes with a lifecycle accept these. */
  async applyStimulus(
    className: string,
    id: number,
    stimulus: string,
    rawFields: unknown,
    options: { comment?: string; fields?: string } = {},
  ): Promise<ObjectDto> {
    const info = this.schema.require(className);
    if (!info.lifecycle) {
      throw badRequest(
        `${info.name} has no lifecycle in the compiled schema, so it accepts no stimuli.`,
      );
    }
    assertIdentifier(stimulus, "stimulus");

    // Fields are optional for a transition, but iTop still requires the key.
    // An EMPTY object counts as "none": plenty of stimuli (ev_close, ev_reopen)
    // carry no data, and validateWrite rightly rejects an empty update -- which
    // would otherwise make those transitions impossible to apply.
    const hasFields =
      rawFields !== undefined &&
      rawFields !== null &&
      !(typeof rawFields === "object" && !Array.isArray(rawFields) && Object.keys(rawFields).length === 0);

    const fields = hasFields
      ? validateWrite(info, rawFields, { mode: "update", strict: true }).fields
      : {};

    const result = await this.client.call("core/apply_stimulus", {
      class: info.name,
      key: id,
      stimulus,
      fields,
      output_fields: this.outputFields(info, options.fields, "full"),
      comment: options.comment?.trim() || this.defaultComment,
    });

    const updated = normalizeObjects(result.objects)[0];
    if (!updated) {
      throw new AppError(
        "upstream_error",
        `iTop accepted the stimulus "${stimulus}" but returned no object.`,
      );
    }
    return this.toDto(updated);
  }

  /**
   * Objects on the far side of a LinkedSet / LinkedSetIndirect attribute.
   *
   * Rather than read the link set off the parent (which returns denormalised
   * rows), this queries the link class directly so the caller gets real objects
   * with ids it can navigate to.
   */
  async links(
    className: string,
    id: number,
    attCode: string,
    query: { page: number; limit: number; fields?: string },
  ): Promise<ListResult> {
    const info = this.schema.require(className);
    const field = info.fields[attCode];
    if (!field) {
      throw notFound(`Unknown attribute "${attCode}" on ${info.name}.`);
    }
    if (field.ui !== "related") {
      throw badRequest(
        `"${attCode}" on ${info.name} is a ${field.ui} attribute, not a relation. ` +
          `Read it from the object itself.`,
      );
    }
    if (!field.linked || !field.linkKey) {
      throw badRequest(
        `The compiled schema has no link class or key for "${attCode}" on ${info.name}.`,
      );
    }

    if (!Number.isInteger(id) || id < 0) {
      throw badRequest(`Invalid object id: ${id}.`);
    }

    const linkedInfo = this.schema.get(field.linked);
    // id is a validated integer, so it is emitted as a numeric literal rather
    // than a quoted string -- comparing an integer column to '5' would force a
    // string coercion in MySQL.
    const oql = `SELECT ${assertIdentifier(field.linked, "linked class")} WHERE ${assertIdentifier(
      field.linkKey,
      "link key",
    )} = ${id}`;

    const page = Math.max(1, query.page);
    const limit = Math.min(Math.max(1, query.limit), MAX_PAGE_SIZE);

    // The link class is often outside the compiled schema (lnk* classes and
    // Ticket/User are not exported), so fall back to iTop's own full field list.
    const outputFields = linkedInfo
      ? this.outputFields(linkedInfo, query.fields, "summary")
      : (query.fields ?? "*");

    const result = await this.client.call("core/get", {
      class: field.linked,
      key: oql,
      output_fields: outputFields,
      limit,
      page,
    });

    const items = normalizeObjects(result.objects).map((flat) => this.toDto(flat));
    const total = parseFoundCount(result.message) ?? items.length;

    return {
      items,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      sortedInBff: false,
    };
  }
}

function sortValue(dto: ObjectDto, code: string): unknown {
  if (code === "id") return dto.id;
  if (code === "friendlyname") return dto.label;
  return dto.fields[code];
}

/**
 * Empty values always sort last, in both directions -- a column of mostly-blank
 * dates is unreadable if descending order fills the first page with blanks. The
 * direction is therefore applied to the value comparison only, not to the
 * empty-value tie-breaks.
 */
export function compareValues(a: unknown, b: unknown, descending = false): number {
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const direction = descending ? -1 : 1;

  // Compare numerically only when BOTH sides are genuinely numeric; Number("")
  // is 0 and Number(" ") is 0, which would mis-rank blank-ish strings.
  const aNum = toNumber(a);
  const bNum = toNumber(b);
  if (aNum !== null && bNum !== null) return direction * (aNum - bNum);

  return (
    direction *
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * iTop returns unset scalars as "" and sometimes as whitespace, so a
 * whitespace-only string counts as empty. Without this a column of blank dates
 * sorts as though those blanks were real values.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim() === "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
