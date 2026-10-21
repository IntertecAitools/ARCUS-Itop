import { z } from "zod";

import { badRequest } from "../../core/errors.js";
import { assertIdentifier, escapeLikeTerm, quoteString } from "../../itop/oql.js";
import type { ClassInfo, Field } from "../../schema/types.js";
import { DEFAULT_ITOP_TIMEZONE, isoToItopTime } from "../../shared/itop-time.js";

/**
 * Advanced search, iTop's criteria builder, in our own vocabulary.
 *
 * The frontend sends `{ field, op, value? | values? }` -- never OQL -- and
 * this module turns each criterion into an OQL condition after checking it
 * against the field's type. Every literal goes through quoteString or a
 * numeric/date check, and every attribute code through the schema, so a
 * criterion cannot inject OQL.
 */

export const CRITERION_OPS = [
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "equals",
  "not_equals",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "empty",
  "not_empty",
] as const;
export type CriterionOp = (typeof CRITERION_OPS)[number];

export const criterionSchema = z.object({
  field: z.string().max(64),
  op: z.enum(CRITERION_OPS),
  value: z.union([z.string().max(200), z.number()]).optional(),
  /** Second bound for `between`. */
  value2: z.union([z.string().max(200), z.number()]).optional(),
  values: z.array(z.union([z.string().max(200), z.number()])).max(100).optional(),
});
export type Criterion = z.infer<typeof criterionSchema>;

export const criteriaSchema = z.array(criterionSchema).max(20);

/** The kind of value a field holds, which decides the operators it takes. */
export type CriterionKind = "string" | "enum" | "key" | "number" | "date";

/** Operators offered per kind, mirroring iTop's search form. */
export const OPS_BY_KIND: Record<CriterionKind, readonly CriterionOp[]> = {
  string: ["contains", "not_contains", "starts_with", "ends_with", "equals", "not_equals", "empty", "not_empty"],
  enum: ["in", "not_in", "empty", "not_empty"],
  key: ["in", "not_in", "empty", "not_empty"],
  number: ["equals", "not_equals", "gt", "gte", "lt", "lte", "between", "empty", "not_empty"],
  date: ["equals", "gt", "gte", "lt", "lte", "between", "empty", "not_empty"],
};

export function criterionKind(field: Field): CriterionKind | null {
  if (field.ui === "related" || field.ui === "ignored") return null;
  if (field.ui === "picker") return "key";
  if (field.values?.length) return "enum";
  if (field.widget === "integer" || field.widget === "decimal") return "number";
  if (field.widget === "date" || field.widget === "datetime") return "date";
  return "string";
}

const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

function asNumber(value: unknown, what: string): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (value === undefined || value === "" || !Number.isFinite(n)) throw badRequest(`${what} must be a number.`);
  return String(n);
}

/**
 * A date criterion's literal; a bare day widens to its first or last second.
 * A bare day or wall-clock time is read on iTop's clock; an exact instant
 * (with Z or an offset) is moved onto it first.
 */
function asDate(value: unknown, what: string, end: boolean, timeZone: string): string {
  const instant = isoToItopTime(String(value ?? ""), timeZone);
  if (instant) return quoteString(instant);
  const text = String(value ?? "").trim().replace("T", " ");
  if (!DATE.test(text)) throw badRequest(`${what} must be a date (YYYY-MM-DD).`);
  if (text.length === 10) return quoteString(`${text} ${end ? "23:59:59" : "00:00:00"}`);
  return quoteString(text.length === 16 ? `${text}:00` : text);
}

function asKey(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw badRequest(`${what} must be a record id.`);
  return text;
}

/** One criterion as an OQL condition. */
export function criterionToOql(
  info: ClassInfo,
  criterion: Criterion,
  timeZone: string = DEFAULT_ITOP_TIMEZONE,
): string {
  const code = assertIdentifier(criterion.field, "attribute code");
  const field = info.fields[code];
  if (!field) throw badRequest(`Unknown attribute "${code}" on ${info.name}.`);
  const kind = criterionKind(field);
  if (!kind) throw badRequest(`"${code}" on ${info.name} cannot be searched on.`);
  const op = criterion.op;
  if (!OPS_BY_KIND[kind].includes(op)) {
    throw badRequest(`"${op}" does not apply to "${code}"; use one of ${OPS_BY_KIND[kind].join(", ")}.`);
  }
  const label = `"${code}"`;

  // iTop's OQL has no NOT: "not empty" is written as the opposite test.
  if (op === "empty" || op === "not_empty") {
    const empty = op === "empty";
    if (kind === "key") return empty ? `${code} = 0` : `${code} != 0`;
    // `!= ''` is false for NULL too, as in SQL.
    if (kind === "string" || kind === "enum") return empty ? `(${code} = '' OR ISNULL(${code}))` : `${code} != ''`;
    return empty ? `ISNULL(${code})` : `ISNULL(${code}) = 0`;
  }

  if (kind === "string") {
    const term = String(criterion.value ?? "");
    if (term.trim() === "") throw badRequest(`${label} needs a value.`);
    const like = (pattern: string) => quoteString(pattern);
    const t = escapeLikeTerm(term.trim());
    switch (op) {
      case "contains":
        return `${code} LIKE ${like(`%${t}%`)}`;
      case "not_contains":
        return `${code} NOT LIKE ${like(`%${t}%`)}`;
      case "starts_with":
        return `${code} LIKE ${like(`${t}%`)}`;
      case "ends_with":
        return `${code} LIKE ${like(`%${t}`)}`;
      case "equals":
        return `${code} = ${quoteString(term)}`;
      default:
        return `${code} != ${quoteString(term)}`;
    }
  }

  if (kind === "enum" || kind === "key") {
    const values = criterion.values ?? (criterion.value !== undefined ? [criterion.value] : []);
    if (values.length === 0) throw badRequest(`${label} needs at least one value.`);
    const literals = values.map((v) => {
      if (kind === "key") return asKey(v, label);
      const text = String(v);
      if (!field.values!.includes(text)) {
        throw badRequest(`${label} must be one of ${field.values!.join(", ")}.`);
      }
      return quoteString(text);
    });
    return `${code} ${op === "in" ? "IN" : "NOT IN"} (${literals.join(", ")})`;
  }

  const literal = (v: unknown, end: boolean) =>
    kind === "number" ? asNumber(v, label) : asDate(v, label, end, timeZone);

  // A bare day on a datetime is a whole day: "equals 2026-10-19" means
  // between its first and last second.
  if (kind === "date" && op === "equals") {
    return `(${code} >= ${literal(criterion.value, false)} AND ${code} <= ${literal(criterion.value, true)})`;
  }
  switch (op) {
    case "equals":
      return `${code} = ${literal(criterion.value, false)}`;
    case "not_equals":
      return `${code} != ${literal(criterion.value, false)}`;
    case "gt":
      return `${code} > ${literal(criterion.value, true)}`;
    case "gte":
      return `${code} >= ${literal(criterion.value, false)}`;
    case "lt":
      return `${code} < ${literal(criterion.value, false)}`;
    case "lte":
      return `${code} <= ${literal(criterion.value, true)}`;
    default:
      return `(${code} >= ${literal(criterion.value, false)} AND ${code} <= ${literal(criterion.value2, true)})`;
  }
}

/** Parses `?criteria=<json>` from a query string. */
export function parseCriteriaParam(raw: string | undefined): Criterion[] {
  if (raw === undefined || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("`criteria` must be a JSON array.");
  }
  const result = criteriaSchema.safeParse(parsed);
  if (!result.success) {
    throw badRequest("`criteria` is not valid.", result.error.issues);
  }
  return result.data;
}
