import type { ItopObjectResult, ItopObjects } from "./types.js";

/** A flattened object, with the composite "Class::id" split apart. */
export interface FlatObject {
  class: string;
  id: number;
  /** OQL alias this row came from, for multi-class (JOIN) results. */
  alias?: string;
  code: number;
  message: string;
  fields: Record<string, unknown>;
}

/**
 * Identity is `class` + `key`. `fields` is deliberately not required: when
 * output_fields narrows the selection iTop can omit it, and dropping the whole
 * object over a missing field map would lose a real row. flatten() defaults it.
 */
function isObjectResult(value: unknown): value is ItopObjectResult {
  return typeof value === "object" && value !== null && "class" in value && "key" in value;
}

function toId(key: string | number): number {
  const id = typeof key === "number" ? key : Number.parseInt(key, 10);
  return Number.isFinite(id) ? id : 0;
}

function flatten(entry: ItopObjectResult, alias?: string): FlatObject {
  const flat: FlatObject = {
    class: entry.class,
    id: toId(entry.key),
    code: entry.code ?? 0,
    message: entry.message ?? "",
    fields: entry.fields ?? {},
  };
  if (alias !== undefined) flat.alias = alias;
  return flat;
}

/**
 * Collapse the three possible `objects` shapes into one flat array.
 *
 * Order is preserved as iTop emitted it. For multi-class results each OQL alias
 * becomes its own entry tagged with `alias`, so a JOIN of N rows over 2 classes
 * yields 2N entries -- callers that care about row grouping should use
 * normalizeObjectSets instead.
 */
export function normalizeObjects(objects: ItopObjects | undefined): FlatObject[] {
  if (objects === null || objects === undefined) return [];

  if (Array.isArray(objects)) {
    const out: FlatObject[] = [];
    for (const row of objects) {
      if (row === null || typeof row !== "object") continue;
      for (const [alias, entry] of Object.entries(row)) {
        if (isObjectResult(entry)) out.push(flatten(entry, alias));
      }
    }
    return out;
  }

  const out: FlatObject[] = [];
  for (const entry of Object.values(objects)) {
    if (isObjectResult(entry)) out.push(flatten(entry));
  }
  return out;
}

/** Preserves row grouping for multi-class (JOIN) results. */
export function normalizeObjectSets(
  objects: ItopObjects | undefined,
): Record<string, FlatObject>[] {
  if (objects === null || objects === undefined) return [];
  if (!Array.isArray(objects)) {
    // Single-class result: every object is its own row.
    return normalizeObjects(objects).map((o) => ({ [o.class]: o }));
  }
  const rows: Record<string, FlatObject>[] = [];
  for (const row of objects) {
    if (row === null || typeof row !== "object") continue;
    const built: Record<string, FlatObject> = {};
    for (const [alias, entry] of Object.entries(row)) {
      if (isObjectResult(entry)) built[alias] = flatten(entry, alias);
    }
    if (Object.keys(built).length > 0) rows.push(built);
  }
  return rows;
}

/**
 * core/get reports the total row count only inside its human-readable message,
 * as "Found: N". DBObjectSet::Count() builds that with limit=0/offset=0
 * (dbobjectset.class.php:808), so N is the count across ALL pages, which is
 * exactly what pagination needs.
 *
 * Returns null when the message does not carry a count, so callers can fall
 * back rather than report a wrong total.
 */
export function parseFoundCount(message: string | null | undefined): number | null {
  if (!message) return null;
  const match = /Found:\s*(\d+)/i.exec(message);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Strips the "Error: " prefix that rest.php prepends to every failure. */
export function cleanMessage(message: string | null | undefined): string {
  if (!message) return "";
  return message.replace(/^Error:\s*/i, "").trim();
}
