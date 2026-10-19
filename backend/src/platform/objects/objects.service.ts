import { AppError, badRequest, notFound } from "../../core/errors.js";
import { resultToAppError, type ItopClient } from "../../itop/client.js";
import { DELETE_CODE_LABELS, ItopCode } from "../../itop/codes.js";
import { isDeadlock, normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { assertIdentifier, buildOql } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { validateWrite } from "../../shared/write-validation.js";
import { criterionToOql, type Criterion } from "./criteria.js";

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
  /** Advanced-search criteria, ANDed with everything else. */
  criteria?: Criterion[];
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

  /** Resolves a `fields` query parameter into an iTop output_fields string. */
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

    // `finalclass` is implicit on every iTop object (the real subclass of a
    // row) and is what dashboards group an abstract class by; like id and
    // friendlyname it is always available but absent from the field map.
    const out = new Set<string>(["id", "friendlyname", "finalclass"]);
    for (const code of requestedCodes) {
      if (code === "id" || code === "friendlyname" || code === "finalclass") continue;
      assertIdentifier(code, "attribute code");
      const field = info.fields[code];
      if (!field) {
        // iTop resolves `<key>_friendlyname` for any ExternalKey, but the
        // datamodel does not declare those as attributes, so they are absent
        // from the schema. Allowing them is what lets a caller read a display
        // name instead of a foreign-key id.
        const base = code.endsWith("_friendlyname")
          ? code.slice(0, -"_friendlyname".length)
          : undefined;
        if (base && info.fields[base]?.ui === "picker") {
          out.add(code);
          continue;
        }
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

  /**
   * Builds the OQL for a list query, validating every identifier it embeds.
   *
   * A base OQL (a navigation view, or a module's own query) is narrowed by `q`
   * and the filters rather than replacing them: the records screen sends both
   * `view` and `q`, and dropping the search would list the whole view while
   * the search box says otherwise. The base goes in as a nested query, so
   * views written with aliases or JOINs need no rewriting.
   */
  private listOql(info: ClassInfo, query: ListQuery): string {
    const narrowed = this.conditionsOql(info, query);
    if (!query.oql) return narrowed ?? buildOql({ class: info.name });
    if (narrowed === null) return query.oql;
    return `${narrowed} AND (id IN (${query.oql}))`;
  }

  /** `SELECT <class> WHERE …` for the filters and `q`, or null when there are none. */
  private conditionsOql(info: ClassInfo, query: ListQuery): string | null {
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
    const criteria = (query.criteria ?? []).map((c) => criterionToOql(info, c));
    if (criteria.length > 0) built.rawConditions = criteria;
    if (Object.keys(equals).length === 0 && !built.search && criteria.length === 0) return null;
    return buildOql(built);
  }

  /**
   * The OQL a list with these parameters runs. Exports use it so the file
   * holds exactly the rows the list shows -- same view, search and filters.
   */
  queryFor(className: string, query: Pick<ListQuery, "q" | "filters" | "oql" | "criteria">): string {
    return this.listOql(this.schema.require(className), { page: 1, limit: 1, ...query });
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

  /**
   * Every matching row, up to `cap`, fetched page by page.
   *
   * list() clamps a page to MAX_PAGE_SIZE, so a caller that needs to scan a set
   * (grouping a dashlet, bucketing a trend) and simply asked for a big `limit`
   * would quietly get the first 500 rows and compute wrong numbers. `total` is
   * iTop's count of all matches, which exceeds `items.length` when truncated.
   */
  async listAll(
    className: string,
    query: Omit<ListQuery, "page" | "limit" | "sort" | "order">,
    cap: number,
  ): Promise<{ items: ObjectDto[]; total: number; truncated: boolean }> {
    const items: ObjectDto[] = [];
    let total = 0;
    for (let page = 1; items.length < cap; page += 1) {
      const result = await this.list(className, { ...query, page, limit: MAX_PAGE_SIZE });
      items.push(...result.items);
      total = result.total;
      if (!result.hasMore || result.items.length === 0) break;
    }
    const kept = items.slice(0, cap);
    return { items: kept, total: Math.max(total, kept.length), truncated: total > kept.length };
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

    const all = normalizeObjects(result.objects).map((flat) => this.toDto(flat));
    const total = parseFoundCount(result.message) ?? all.length;
    if (total > SORT_ROW_CAP) {
      throw new AppError(
        "bad_request",
        `Sorting needs the full result set, but ${total} rows match and the cap is ` +
          `${SORT_ROW_CAP}. iTop's REST API cannot sort server-side, so narrow the ` +
          `query with q/filters, or drop the sort parameter.`,
        { details: { total, cap: SORT_ROW_CAP } },
      );
    }

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

    // A numeric key that matches nothing is not an error to iTop: the set is
    // empty, DeleteObjects plans nothing, and the code is OK. An existing
    // object always appears in its own plan, so an empty plan means "no such
    // object" -- reporting that as a successful delete would be a lie.
    if (result.code === ItopCode.OK && plan.length === 0) {
      throw notFound(`${className}::${id} was not found.`);
    }

    if (result.code === ItopCode.OK) {
      return { simulated: simulate, ok: true, message: result.message ?? "", plan };
    }

    // A simulation is informational: UNSAFE here means "this delete would need
    // explicit confirmation", which is exactly what the caller asked about.
    // Every stopper (UNSAFE, a security issue, a per-object issue) comes with
    // the plan that explains it, and showing that plan is the point of asking.
    if (simulate && plan.length > 0) {
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

    // Anything else (no rights, an invalid key) maps exactly as call() maps
    // it, keeping the plan when iTop sent one.
    const error = resultToAppError("core/delete", result);
    if (plan.length === 0) throw error;
    throw new AppError(error.code, error.message, { itopCode: result.code, details: { plan } });
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
    if (!info.lifecycle.userActions.includes(stimulus)) {
      // iTop's REST API would apply an internal stimulus (ev_timeout,
      // ev_autoresolve) for an administrator; people never should.
      throw badRequest(`"${stimulus}" is not an action people can take on ${info.name}.`);
    }

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

  /**
   * The link-set attribute behind an add/remove, checked the way iTop's
   * console would allow it.
   */
  private linkSet(className: string, attCode: string, action: "add" | "remove") {
    const info = this.schema.require(className);
    const field = info.fields[attCode];
    if (!field || field.ui !== "related" || !field.linked || !field.linkKey) {
      throw badRequest(`"${attCode}" on ${info.name} is not a link set.`);
    }
    if (field.editMode === "none") {
      throw badRequest(`iTop does not allow editing "${attCode}" on ${info.name}.`);
    }
    if (action === "remove" && field.editMode === "add_only") {
      throw badRequest(`iTop allows adding to "${attCode}" on ${info.name}, not removing.`);
    }
    const indirect = field.type === "LinkedSetIndirect";
    if (indirect && !field.remoteKey) {
      throw badRequest(
        `The schema does not say which key of ${field.linked} points at the far side of ` +
          `"${attCode}", so links cannot be added or removed here.`,
      );
    }
    return { info, field, indirect, linked: field.linked, linkKey: field.linkKey };
  }

  /**
   * Links one object into a link set.
   *
   * n-n (LinkedSetIndirect): creates a row of the link class pointing at both
   * sides, e.g. an lnkPersonToTeam with team_id + person_id. `fields` carries
   * the link's own attributes (a role on a team membership).
   *
   * 1-n (LinkedSet): the far object holds the key, so it is updated to point
   * here -- which moves it if it pointed somewhere else, as iTop's console does.
   */
  async addLink(
    className: string,
    id: number,
    attCode: string,
    targetId: number,
    fields: Record<string, unknown> = {},
  ): Promise<LinkOutcome> {
    const { info, field, indirect, linked, linkKey } = this.linkSet(className, attCode, "add");
    const comment = `Linked through ${info.name}.${attCode}`;

    if (indirect) {
      const { object } = await this.create(
        linked,
        { ...fields, [linkKey]: id, [field.remoteKey!]: targetId },
        { comment },
      );
      return { object };
    }

    const { object } = await this.update(linked, targetId, { [linkKey]: id }, { comment });
    return { object };
  }

  /**
   * Removes one entry from a link set.
   *
   * `itemId` is the id the links listing returned for the row: the link-class
   * row for n-n (deleted), the far object for 1-n (detached by clearing its
   * key). A 1-n key that is mandatory cannot be cleared, so that case is
   * refused rather than deleting the far object behind the caller's back.
   * The row must belong to THIS object either way.
   */
  async removeLink(className: string, id: number, attCode: string, itemId: number): Promise<void> {
    const { info, indirect, linked, linkKey } = this.linkSet(className, attCode, "remove");
    const comment = `Unlinked from ${info.name}.${attCode}`;

    const row = await this.client.call("core/get", {
      class: linked,
      key: `SELECT ${assertIdentifier(linked, "linked class")} WHERE id = ${itemId} AND ${assertIdentifier(linkKey, "link key")} = ${id}`,
      output_fields: "id",
      limit: 1,
    });
    if (normalizeObjects(row.objects).length === 0) {
      throw notFound(`${linked}::${itemId} is not linked to ${info.name}::${id} through ${attCode}.`);
    }

    if (indirect) {
      await this.remove(linked, itemId, { comment });
      return;
    }

    const keyField = this.schema.get(linked)?.fields[linkKey];
    if (keyField?.required) {
      throw badRequest(
        `${linked} must always belong to a ${info.name} (${linkKey} is mandatory), so it ` +
          `cannot be detached. Link it elsewhere or delete it instead.`,
      );
    }
    await this.update(linked, itemId, { [linkKey]: 0 }, { comment });
  }

  /**
   * Applies one action to many records -- iTop's bulk modify / bulk delete /
   * bulk transition.
   *
   * The REST API has no batch verb, so each record is its own call, a few in
   * flight at a time. Writes are not transactional across records: a failure
   * on one does not undo the others, which is why every record's outcome is
   * reported rather than a single yes/no.
   */
  async bulk(className: string, ids: number[], request: BulkAction, comment?: string): Promise<BulkResult> {
    const info = this.schema.require(className);
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw badRequest("Select at least one record.");
    if (unique.length > MAX_BULK_IDS) {
      throw badRequest(`A bulk action can touch at most ${MAX_BULK_IDS} records; ${unique.length} were sent.`);
    }
    // Validate once up front, so a bad payload fails the request instead of
    // failing identically for every record.
    if (request.action === "update") validateWrite(info, request.fields, { mode: "update" });
    if (request.action === "stimulus") {
      if (!info.lifecycle) throw badRequest(`${info.name} has no lifecycle, so it accepts no actions.`);
      assertIdentifier(request.stimulus, "stimulus");
    }

    const options = comment ? { comment } : {};
    const run = async (id: number): Promise<void> => {
      if (request.action === "update") await this.update(className, id, request.fields, options);
      else if (request.action === "stimulus") {
        await this.applyStimulus(className, id, request.stimulus, request.fields ?? {}, options);
      } else await this.remove(className, id, options);
    };

    // A deadlock means MySQL rolled that record's transaction back, so trying
    // it again is safe; anything else is the record's real outcome.
    const attempt = async (id: number) => {
      for (let tries = 1; ; tries += 1) {
        try {
          return await run(id);
        } catch (error) {
          if (tries >= 3 || !isDeadlock(error instanceof Error ? error.message : "")) throw error;
          await new Promise((r) => setTimeout(r, 200 * tries));
        }
      }
    };

    // Deletes run one at a time: deleting from a hierarchy (Organization,
    // Location, Group) rewrites the whole tree's bounds, and parallel deletes
    // deadlock on it in MySQL -- seen against a live instance.
    const concurrency = request.action === "delete" ? 1 : BULK_CONCURRENCY;
    const results: BulkResult["results"] = new Array(unique.length);
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const index = next++;
        const id = unique[index]!;
        try {
          await attempt(id);
          results[index] = { id, ok: true };
        } catch (error) {
          results[index] = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  /** What deleting all these records would do, in one dry run. */
  async bulkDeletePlan(className: string, ids: number[]) {
    const info = this.schema.require(className);
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw badRequest("Select at least one record.");
    if (unique.length > MAX_BULK_IDS) {
      throw badRequest(`A bulk action can touch at most ${MAX_BULK_IDS} records.`);
    }
    const result = await this.client.callRaw("core/delete", {
      class: info.name,
      key: `SELECT ${assertIdentifier(info.name, "class")} WHERE id IN (${unique.join(",")})`,
      simulate: true,
      comment: this.defaultComment,
    });
    const plan = normalizeObjects(result.objects).map((flat) => ({
      class: flat.class,
      id: flat.id,
      outcome: DELETE_CODE_LABELS[flat.code] ?? `code ${flat.code}`,
      detail: flat.message,
    }));
    if (result.code !== ItopCode.OK && plan.length === 0) {
      throw resultToAppError("core/delete", result);
    }
    return { simulated: true, ok: result.code === ItopCode.OK, message: result.message ?? "", plan };
  }
}

/** Most records one bulk request may touch; iTop is ~0.5 s per write. */
export const MAX_BULK_IDS = 500;
const BULK_CONCURRENCY = 4;

export type BulkAction =
  | { action: "update"; fields: Record<string, unknown> }
  | { action: "stimulus"; stimulus: string; fields?: Record<string, unknown> }
  | { action: "delete" };

export interface BulkResult {
  results: { id: number; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

export interface LinkOutcome {
  /** The row that now represents the link (a link-class row, or the remote object). */
  object: ObjectDto;
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
