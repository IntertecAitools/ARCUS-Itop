import { badRequest } from "../../core/errors.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo, Field } from "../../schema/types.js";
import type { ImportClass } from "./data-import.types.js";

/**
 * The classes the wizard loads, and the columns a row is matched on unless
 * the admin picks others: people by email, organisations by name, the rest
 * by name within their organisation (a software instance within the system
 * it runs on). Classes missing from the schema are left out.
 */
const IMPORT_CLASSES: { name: string; keys: string[] }[] = [
  { name: "Person", keys: ["email"] },
  { name: "Organization", keys: ["name"] },
  { name: "Team", keys: ["name", "org_id->name"] },
  { name: "Location", keys: ["name", "org_id->name"] },
  { name: "Server", keys: ["name", "org_id->name"] },
  { name: "PC", keys: ["name", "org_id->name"] },
  { name: "NetworkDevice", keys: ["name", "org_id->name"] },
  { name: "ApplicationSolution", keys: ["name", "org_id->name"] },
  { name: "DBServer", keys: ["name", "system_id->name"] },
  { name: "Middleware", keys: ["name", "system_id->name"] },
  { name: "WebServer", keys: ["name", "system_id->name"] },
  { name: "PCSoftware", keys: ["name", "system_id->name"] },
  { name: "OtherSoftware", keys: ["name", "system_id->name"] },
  { name: "Software", keys: ["name", "version"] },
];

export function importClasses(schema: CmdbSchema): ImportClass[] {
  return IMPORT_CLASSES.filter((c) => schema.has(c.name)).map((c) => {
    const info = schema.require(c.name);
    return { name: info.name, label: info.labels?.class ?? info.name, defaultKeys: c.keys };
  });
}

export function assertImportClass(schema: CmdbSchema, className: string): ClassInfo {
  const known = IMPORT_CLASSES.find((c) => c.name === className);
  if (!known || !schema.has(className)) {
    throw badRequest(`${className} is not a class the import loads. Use one of: ${IMPORT_CLASSES.map((c) => c.name).join(", ")}.`);
  }
  return schema.require(className);
}

/** A mapped column: the attribute it fills, and for a reference the field it is matched on. */
export interface ColumnTarget {
  /** The target as given: `name`, `org_id`, `org_id->name`, `id`. */
  target: string;
  code: string;
  field?: Field;
  /** For `org_id->name`: "name". */
  lookup?: string;
}

/**
 * Checks a column target against the schema: `id`, a writable attribute
 * (scalar, or a reference given by id), or a reference matched on a field of
 * the class it points at.
 */
export function parseTarget(schema: CmdbSchema, info: ClassInfo, target: string): ColumnTarget {
  if (target === "id") return { target, code: "id" };
  const [code = "", lookup, ...rest] = target.split("->");
  const field = info.fields[code];
  if (!field || !info.writable.includes(code) || (field.ui !== "scalar" && field.ui !== "picker") || field.type === "CaseLog") {
    throw badRequest(`"${code}" is not a field of ${info.name} that can be imported.`);
  }
  if (lookup === undefined) return { target, code, field };
  if (rest.length > 0 || field.ui !== "picker" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(lookup)) {
    throw badRequest(`"${target}" is not a column the import can match.`);
  }
  const targetInfo = field.target ? schema.get(field.target) : undefined;
  if (targetInfo && lookup !== "friendlyname" && lookup !== "id" && !targetInfo.fields[lookup]) {
    throw badRequest(`${targetInfo.name} has no field "${lookup}" to match "${code}" on.`);
  }
  return { target, code, field, lookup };
}

/**
 * The value iTop keeps, as text, for comparing a file's value with a
 * record's: references by id, numbers without trailing zeros, HTML without
 * its tags, text trimmed.
 */
export function comparable(field: Field | undefined, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field?.ui === "picker") return String(value) === "0" ? "" : String(value);
  const text = String(value);
  if (field?.widget === "integer" || field?.widget === "decimal") {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) ? String(n) : text.trim();
  }
  if (field && /HTML/i.test(field.type)) return htmlToText(text);
  return text.replace(/\r\n/g, "\n").trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** How a key value is compared: iTop's database matches text without regard to case. */
export function keyPart(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Splits a list into runs of at most `size`. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `work` over `items`, at most `limit` at once, keeping the order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
