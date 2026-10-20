import { badRequest } from "../../core/errors.js";
import type { ClassInfo } from "../../schema/types.js";
import { criterionKind, criterionToOql, type Criterion } from "../objects/criteria.js";

/**
 * A notification rule's "only when…" conditions, as iTop's trigger `filter`.
 *
 * Writing reuses the advanced-search translation (criterionToOql), so the
 * conditions mean exactly what they mean in a record list. Reading parses
 * back the forms that translation produces; anything else in a filter (set
 * up in iTop) is returned as `kept` and written back unchanged, ANDed with
 * the conditions, unless the user drops it.
 */

export interface ParsedFilter {
  conditions: Criterion[];
  /** Parts of the filter this screen cannot show; written back as they are. */
  kept: string[];
}

/** Conditions plus kept parts to a filter; "" when there is nothing to filter on. */
export function conditionsToFilter(info: ClassInfo, conditions: Criterion[], kept: string[] = []): string {
  // A filter of another shape (a JOIN, another alias) is kept whole and
  // cannot be combined with anything.
  const whole = kept.find((k) => /^SELECT\s/i.test(k));
  if (whole) {
    if (conditions.length || kept.length > 1) {
      throw badRequest(
        "This rule has a condition set up in iTop that cannot be combined with others. Remove it to add conditions here.",
      );
    }
    return whole;
  }
  const parts = [...conditions.map((c) => criterionToOql(info, c)), ...kept.map((k) => `(${k})`)];
  return parts.length ? `SELECT ${info.name} WHERE ${parts.join(" AND ")}` : "";
}

/** Splits on AND at bracket depth 0, outside quotes. */
function splitTopLevelAnd(where: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < where.length; i++) {
    const c = where[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (depth === 0 && /^\sAND\s/i.test(where.slice(i, i + 5))) {
      parts.push(where.slice(start, i).trim());
      start = i + 5;
      i += 4;
    }
  }
  parts.push(where.slice(start).trim());
  return parts.filter(Boolean);
}

/** `'it\'s'` -> `it's`; undefined when the text is not one quoted literal. */
function unquote(literal: string): string | undefined {
  const m = /^'((?:[^'\\]|\\.)*)'$/s.exec(literal.trim());
  return m ? m[1]!.replace(/\\(.)/g, "$1") : undefined;
}

/** Splits `'a', 'b'` or `1, 2` into literals, respecting quotes. */
function splitList(list: string): string[] {
  const out: string[] = [];
  let quote = false;
  let current = "";
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote && c === "\\") {
      current += c + (list[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "'") quote = !quote;
    if (c === "," && !quote) {
      out.push(current.trim());
      current = "";
    } else current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const unescapeLike = (s: string) => s.replace(/\\([\\%_])/g, "$1");

/** One part of a filter as a condition, when it is one this screen writes. */
function parsePart(info: ClassInfo, raw: string): Criterion | undefined {
  let part = raw.trim();
  let negated = false;
  const not = /^NOT \((.*)\)$/s.exec(part);
  if (not) {
    negated = true;
    part = not[1]!.trim();
  }
  while (/^\(.*\)$/s.test(part) && !/^\(.*\)\s*(AND|OR)\s*\(.*\)$/is.test(part)) part = part.slice(1, -1).trim();

  const fieldOf = (code: string) => {
    const field = info.fields[code];
    const kind = field ? criterionKind(field) : null;
    return kind && kind !== "date" ? kind : null;
  };

  // empty / not empty
  let m = /^([a-z0-9_]+) = 0$/.exec(part);
  if (m && fieldOf(m[1]!) === "key") return { field: m[1]!, op: negated ? "not_empty" : "empty" };
  m = /^\(?([a-z0-9_]+) = '' OR ISNULL\(([a-z0-9_]+)\)\)?$/.exec(part);
  if (m && m[1] === m[2] && ["string", "enum"].includes(fieldOf(m[1]!) ?? "")) {
    return { field: m[1]!, op: negated ? "not_empty" : "empty" };
  }
  m = /^ISNULL\(([a-z0-9_]+)\)$/.exec(part);
  if (m && fieldOf(m[1]!) === "number") return { field: m[1]!, op: negated ? "not_empty" : "empty" };
  if (negated) return undefined;

  // in / not in
  m = /^([a-z0-9_]+) (NOT IN|IN) \((.*)\)$/s.exec(part);
  if (m) {
    const kind = fieldOf(m[1]!);
    const literals = splitList(m[3]!);
    if (kind === "key" && literals.every((l) => /^\d+$/.test(l))) {
      return { field: m[1]!, op: m[2] === "IN" ? "in" : "not_in", values: literals };
    }
    if (kind === "enum") {
      const values = literals.map(unquote);
      if (values.every((v): v is string => v !== undefined)) {
        return { field: m[1]!, op: m[2] === "IN" ? "in" : "not_in", values };
      }
    }
    return undefined;
  }

  // text
  m = /^([a-z0-9_]+) (NOT LIKE|LIKE) ('.*')$/s.exec(part);
  if (m && fieldOf(m[1]!) === "string") {
    const pattern = unquote(m[3]!);
    if (pattern === undefined) return undefined;
    const starts = pattern.startsWith("%");
    const ends = pattern.endsWith("%") && !pattern.endsWith("\\%");
    const term = unescapeLike(pattern.slice(starts ? 1 : 0, ends ? -1 : undefined));
    if (m[2] === "NOT LIKE") return starts && ends ? { field: m[1]!, op: "not_contains", value: term } : undefined;
    const op = starts && ends ? "contains" : ends ? "starts_with" : starts ? "ends_with" : undefined;
    return op ? { field: m[1]!, op, value: term } : undefined;
  }

  // equals / comparisons
  m = /^([a-z0-9_]+) (=|!=|>=|<=|>|<) (.+)$/s.exec(part);
  if (m) {
    const kind = fieldOf(m[1]!);
    const ops = { "=": "equals", "!=": "not_equals", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const;
    const op = ops[m[2] as keyof typeof ops];
    if (kind === "string" && (op === "equals" || op === "not_equals")) {
      const value = unquote(m[3]!);
      return value === undefined ? undefined : { field: m[1]!, op, value };
    }
    if (kind === "number" && /^-?\d+(\.\d+)?$/.test(m[3]!.trim())) {
      return { field: m[1]!, op, value: m[3]!.trim() };
    }
  }
  return undefined;
}

/** A trigger's filter back to conditions, and whatever else it held. */
export function filterToConditions(info: ClassInfo, filter: string): ParsedFilter {
  const text = filter.replace(/\s+/g, " ").trim();
  if (!text) return { conditions: [], kept: [] };
  const prefix = new RegExp(`^SELECT ${info.name} WHERE `, "i");
  if (!prefix.test(text)) return { conditions: [], kept: [text] };

  const parsed: ParsedFilter = { conditions: [], kept: [] };
  for (const part of splitTopLevelAnd(text.replace(prefix, ""))) {
    const condition = parsePart(info, part);
    if (condition) parsed.conditions.push(condition);
    else parsed.kept.push(part.replace(/^\((.*)\)$/s, "$1"));
  }
  return parsed;
}
