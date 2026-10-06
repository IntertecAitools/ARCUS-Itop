import { badRequest } from "../core/errors.js";

/**
 * OQL construction.
 *
 * The REST API offers no bind parameters: `key` is either an id, a criteria
 * object, or a raw OQL string that iTop hands straight to
 * DBObjectSearch::FromOQL. Any value interpolated into that string is an
 * injection vector, so every literal goes through quoteString below and every
 * identifier is checked against the compiled schema by the caller.
 *
 * Escaping rules, derived from iTop/core/oql/oql-lexer.plex line 172 and
 * iTop/core/oql/oql-parser.y line 199:
 *
 *   strval = /"([^\\"]|\\"|\\\\)*"|'([^\']|\\'|\\\\)*'/
 *   str_value(A) ::= STRVAL(X). {A=stripslashes(substr(X, 1, strlen(X) - 2));}
 *
 * Inside a single-quoted literal the lexer accepts exactly two escapes, \\ and
 * \', and the parser then reverses them with stripslashes. So escaping
 * backslash and apostrophe -- in that order -- is both necessary and
 * sufficient. Escaping anything else would survive stripslashes as a literal
 * backslash and corrupt the value.
 */
export function quoteString(value: string): string {
  // A NUL byte would be re-interpreted by stripslashes if it ever met a
  // preceding backslash, and no legitimate CMDB value contains one.
  if (value.includes("\0")) {
    throw badRequest("Value contains a NUL byte, which OQL cannot represent.");
  }
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** iTop class and attribute codes are strict identifiers. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertIdentifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) {
    throw badRequest(`Invalid ${what}: "${value}".`);
  }
  return value;
}

export interface OqlQuery {
  /** Class to select from. Must already be validated against the schema. */
  class: string;
  /** attcode => value equality conditions, ANDed together. */
  equals?: Record<string, string | number | boolean | null>;
  /** Free-text search: OR of `attcode LIKE '%term%'` over these attributes. */
  search?: { term: string; attributes: string[] };
  /** Raw, already-validated condition fragments, ANDed with the rest. */
  rawConditions?: string[];
}

function renderLiteral(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw badRequest(`Non-finite number cannot be used in a query: ${value}.`);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return quoteString(value);
}

/**
 * LIKE patterns have a second escaping layer on top of the string literal:
 * MySQL treats % and _ as wildcards, so a user searching for "50%" must not
 * match everything. The backslash escapes here are consumed by MySQL's LIKE,
 * and quoteString then protects the backslashes themselves.
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function buildOql(query: OqlQuery): string {
  const cls = assertIdentifier(query.class, "class name");
  const conditions: string[] = [];

  for (const [attCode, value] of Object.entries(query.equals ?? {})) {
    assertIdentifier(attCode, "attribute code");
    if (value === null) {
      conditions.push(`${attCode} IS NULL`);
    } else {
      conditions.push(`${attCode} = ${renderLiteral(value)}`);
    }
  }

  if (query.search && query.search.term.trim() !== "") {
    const attributes = query.search.attributes;
    if (attributes.length === 0) {
      throw badRequest("A text search needs at least one searchable attribute.");
    }
    const pattern = quoteString(`%${escapeLikeTerm(query.search.term.trim())}%`);
    const ors = attributes.map(
      (attCode) => `${assertIdentifier(attCode, "attribute code")} LIKE ${pattern}`,
    );
    conditions.push(`(${ors.join(" OR ")})`);
  }

  for (const raw of query.rawConditions ?? []) {
    if (raw.trim() !== "") conditions.push(`(${raw})`);
  }

  // No ORDER BY: iTop's OQL grammar has no such production (core/oql/oql-parser.y
  // defines none), and core/get hardcodes DBObjectSet's $aOrderBy to [] at
  // restservices.class.inc.php:556. Sorting is therefore done in the BFF -- see
  // services/objects.ts.
  let oql = `SELECT ${cls}`;
  if (conditions.length > 0) {
    oql += ` WHERE ${conditions.join(" AND ")}`;
  }
  return oql;
}
