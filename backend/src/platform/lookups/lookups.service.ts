import { badRequest } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount } from "../../itop/normalize.js";
import { buildOql } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo, Field } from "../../schema/types.js";

export interface Option {
  id: number;
  label: string;
  /** Extra attributes a dependent picker needs in order to filter client-side. */
  context?: Record<string, unknown>;
}

export interface OptionsResult {
  options: Option[];
  total: number;
  truncated: boolean;
  /** Set when the picker's options depend on other attributes. */
  dependsOn?: string[];
  /** The datamodel's raw OQL filter, when one exists. */
  filter?: string;
  /** True when the filter could not be honoured and had to be ignored. */
  filterIgnored?: boolean;
}

const DEFAULT_OPTION_LIMIT = 100;
const MAX_OPTION_LIMIT = 500;

interface CacheEntry {
  expiresAt: number;
  value: OptionsResult;
}

/**
 * Serves the option lists behind dropdowns.
 *
 * Two things make this more than a thin wrapper over core/get:
 *
 *  1. Dependent pickers. The datamodel constrains many external keys with an
 *     OQL filter referencing the object being edited, e.g. Server.model_id has
 *     "SELECT Model WHERE brand_id=:this->brand_id AND type=:this->finalclass".
 *     Those :this-> placeholders cannot be evaluated here -- there is no object
 *     yet during a create -- so the filter is translated into plain conditions
 *     when the caller supplies the referenced values, and reported as ignored
 *     when it cannot be.
 *  2. Caching. Lookup lists are small, hot, and change rarely.
 */
export class LookupsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly cacheTtlMs: number,
  ) {}

  /** Options for a standalone class, e.g. every Organization. */
  async forClass(
    className: string,
    query: { q?: string; limit?: number } = {},
  ): Promise<OptionsResult> {
    const info = this.schema.require(className);
    return this.fetch(info, { q: query.q, limit: query.limit });
  }

  /**
   * Options valid for one picker attribute, honouring its datamodel filter.
   *
   * `context` carries the values of the attributes the filter depends on, which
   * the caller takes from the form being edited.
   */
  async forField(
    className: string,
    attCode: string,
    query: { q?: string; limit?: number; context?: Record<string, string> } = {},
  ): Promise<OptionsResult> {
    const info = this.schema.require(className);
    const field = info.fields[attCode];
    if (!field) {
      throw badRequest(`Unknown attribute "${attCode}" on ${info.name}.`);
    }
    if (field.ui !== "picker") {
      throw badRequest(
        `"${attCode}" on ${info.name} is a ${field.ui} attribute and has no option list.`,
      );
    }
    if (!field.target) {
      throw badRequest(`The compiled schema records no target class for "${attCode}".`);
    }
    if (field.targetAvailable === false) {
      throw badRequest(
        `"${attCode}" targets ${field.target}, which is not in the compiled schema, ` +
          `so its options cannot be listed. extract-schema.py exports the whole datamodel, ` +
          `so this normally means the iTop module defining ${field.target} is not installed.`,
      );
    }

    const targetInfo = this.schema.require(field.target);
    const translated = translateFilter(field, targetInfo, query.context ?? {});

    const result = await this.fetch(targetInfo, {
      q: query.q,
      limit: query.limit,
      equals: translated.equals,
      contextFields: translated.contextFields,
    });

    if (field.dependsOn) result.dependsOn = field.dependsOn;
    if (field.filter) result.filter = field.filter;
    if (translated.ignored) result.filterIgnored = true;
    return result;
  }

  private async fetch(
    info: ClassInfo,
    options: {
      q?: string;
      limit?: number;
      equals?: Record<string, string | number | null>;
      contextFields?: string[];
    },
  ): Promise<OptionsResult> {
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_OPTION_LIMIT), MAX_OPTION_LIMIT);

    const built: Parameters<typeof buildOql>[0] = { class: info.name };
    if (options.equals && Object.keys(options.equals).length > 0) built.equals = options.equals;
    if (options.q && options.q.trim() !== "" && info.searchable.length > 0) {
      built.search = { term: options.q, attributes: info.searchable };
    }
    const oql = buildOql(built);

    const cacheKey = `${oql}|${limit}|${(options.contextFields ?? []).join(",")}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, options: [...cached.value.options] };
    }

    const fieldCodes = new Set<string>(["id", "friendlyname"]);
    if (info.fields["name"]) fieldCodes.add("name");
    for (const code of options.contextFields ?? []) {
      if (info.fields[code]) fieldCodes.add(code);
    }

    const result = await this.client.call("core/get", {
      class: info.name,
      key: oql,
      output_fields: [...fieldCodes].join(","),
      limit,
      page: 1,
    });

    const rows = normalizeObjects(result.objects);
    const total = parseFoundCount(result.message) ?? rows.length;

    const optionList: Option[] = rows.map((row) => {
      const friendly = row.fields["friendlyname"];
      const name = row.fields["name"];
      const label =
        typeof friendly === "string" && friendly !== ""
          ? friendly
          : typeof name === "string" && name !== ""
            ? name
            : `${row.class}::${row.id}`;

      const option: Option = { id: row.id, label };
      const context: Record<string, unknown> = {};
      for (const code of options.contextFields ?? []) {
        if (code in row.fields) context[code] = row.fields[code];
      }
      if (Object.keys(context).length > 0) option.context = context;
      return option;
    });

    const value: OptionsResult = {
      options: optionList,
      total,
      truncated: total > optionList.length,
    };

    if (this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, value });
      // Keep the map from growing without bound under varied search terms.
      if (this.cache.size > 500) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
    }

    return { ...value, options: [...value.options] };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

interface TranslatedFilter {
  equals: Record<string, string | number | null>;
  /** Attributes to return alongside each option, for client-side filtering. */
  contextFields: string[];
  /** True when part of the filter could not be expressed. */
  ignored: boolean;
}

/**
 * Turns a datamodel picker filter into equality conditions.
 *
 * Only the simple, overwhelmingly common form is translated:
 *
 *   SELECT <Class> WHERE a = :this->x AND b = :this->y
 *
 * which covers Server.model_id, Server.osversion_id, Server.oslicence_id,
 * Server.enclosure_id, Server.rack_id, Server.powerA_id and so on. Anything
 * with a JOIN or a BELOW clause -- Server.location_id is the notable one -- is
 * reported as ignored rather than mistranslated, and the referenced attributes
 * are returned as option context so the caller can filter client-side if it
 * wants to.
 */
export function translateFilter(
  field: Field,
  targetInfo: ClassInfo,
  context: Record<string, string>,
): TranslatedFilter {
  const result: TranslatedFilter = { equals: {}, contextFields: [], ignored: false };

  const filter = field.filter;
  if (!filter) {
    // No datamodel filter, but the attribute may still declare dependencies.
    return result;
  }

  // Anything beyond a flat WHERE of ANDed equalities is out of scope.
  const whereMatch = /^\s*SELECT\s+\w+\s+WHERE\s+(.+)$/is.exec(filter);
  if (!whereMatch?.[1] || /\bJOIN\b|\bBELOW\b|\bFROM\b/i.test(filter)) {
    result.ignored = true;
    for (const dep of field.dependsOn ?? []) result.contextFields.push(dep);
    return result;
  }

  const clauses = whereMatch[1].split(/\s+AND\s+/i);
  for (const clause of clauses) {
    const parts = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(clause);
    if (!parts?.[1] || !parts[2]) {
      result.ignored = true;
      continue;
    }
    const [, attCode, rhs] = parts;

    if (!targetInfo.fields[attCode]) {
      // Filter references an attribute the schema does not know about.
      result.ignored = true;
      continue;
    }

    const placeholder = /^:this->(\w+)$/.exec(rhs.trim());
    if (!placeholder?.[1]) {
      // A literal on the right-hand side: strip quotes and use it as-is.
      const literal = rhs.trim().replace(/^'(.*)'$/s, "$1");
      result.equals[attCode] = literal;
      continue;
    }

    const sourceAttCode = placeholder[1];
    const supplied = context[sourceAttCode];

    // `finalclass` is the class of the object being edited, which the caller may
    // not think to pass; fall back to the class name itself.
    if (supplied === undefined && sourceAttCode === "finalclass") {
      result.ignored = true;
      result.contextFields.push(attCode);
      continue;
    }

    if (supplied === undefined || supplied === "") {
      // The dependency is unset, so the option list cannot be narrowed yet.
      // Report it so the UI can keep the dropdown disabled.
      result.ignored = true;
      result.contextFields.push(attCode);
      continue;
    }

    result.equals[attCode] = /^-?\d+$/.test(supplied) ? Number.parseInt(supplied, 10) : supplied;
  }

  result.contextFields = [...new Set(result.contextFields)];
  return result;
}
