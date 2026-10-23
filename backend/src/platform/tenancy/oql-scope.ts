import { ScopeRefusal, type ScopeRules } from "./scope-rules.js";

/**
 * Splits an OQL text at its top-level UNIONs, outside string literals and
 * parentheses. iTop requires every part of a union to select the same class.
 */
export function splitUnion(oql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < oql.length; i += 1) {
    const ch = oql[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (
      depth === 0 &&
      /^union\b/i.test(oql.slice(i, i + 6)) &&
      (i === 0 || /[\s)]/.test(oql[i - 1]!))
    ) {
      parts.push(oql.slice(start, i).trim());
      start = i + 5;
      i += 4;
    }
  }
  parts.push(oql.slice(start).trim());
  return parts;
}

/** `oql` with string literals blanked, so a pattern cannot match inside one. */
function withoutLiterals(oql: string): string {
  return oql.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (m) => `'${" ".repeat(Math.max(0, m.length - 2))}'`);
}

/**
 * The class one SELECT (no UNION) returns. `SELECT Class`, `SELECT Class AS a
 * …` and `SELECT a FROM Class AS a JOIN …` are understood; anything else
 * (several selected classes, no SELECT) is null, and the guard refuses it.
 */
export function selectedClassOf(select: string): string | null {
  const text = withoutLiterals(select);
  const head = /^\s*SELECT\s+([A-Za-z_]\w*)\s*(,)?(?:\s+AS\s+([A-Za-z_]\w*))?\s*(FROM\b)?/i.exec(text);
  if (!head?.[1] || head[2]) return null;
  if (!head[4]) return head[1];
  const alias = head[1];
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)(?:\s+AS)?\s+([A-Za-z_]\w*)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[2] === alias) return m[1] ?? null;
  }
  // "SELECT Class FROM Class" (no alias) also names the class itself.
  const plain = /\bFROM\s+([A-Za-z_]\w*)\s*(?:$|\bWHERE\b|\bJOIN\b)/i.exec(text);
  return plain?.[1] === alias ? alias : null;
}

/**
 * The single record class a polymorphic query is about, read from an
 * `objclass = 'X'` (or `IN ('X')`) condition on it. Several classes, or a
 * condition the guard cannot read, give null: the query is then refused.
 */
export function itemClassOf(select: string, classAttr: string): string | null {
  const eq = new RegExp(`\\b${classAttr}\\s*=\\s*'([A-Za-z_]\\w*)'`, "gi");
  const found = new Set<string>();
  for (let m = eq.exec(select); m; m = eq.exec(select)) found.add(m[1]!);
  const inList = new RegExp(`\\b${classAttr}\\s+IN\\s*\\(\\s*'([A-Za-z_]\\w*)'\\s*\\)`, "gi");
  for (let m = inList.exec(select); m; m = inList.exec(select)) found.add(m[1]!);
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Rewrites a query so it returns only the tenant's records:
 * `SELECT C WHERE id IN (<the query>) AND <tenant condition>`, per part of a
 * union. The original runs untouched as a subquery, so aliases, joins and
 * parameters keep their meaning, and whatever it selects, the outer query
 * can only narrow it. `write` uses the stricter write condition.
 */
export function scopeOql(oql: string, rules: ScopeRules, orgIds: number[], write = false): string {
  return splitUnion(oql)
    .map((part) => {
      const cls = selectedClassOf(part);
      if (!cls) throw new ScopeRefusal("This query", "cannot be checked against your organisations; select one kind of record");
      const filter = write ? rules.writeFilter(cls, orgIds) : readFilterFor(cls, part, rules, orgIds);
      return filter === null ? part : `SELECT ${cls} WHERE id IN (${part}) AND ${filter}`;
    })
    .join(" UNION ");
}

function readFilterFor(cls: string, part: string, rules: ScopeRules, orgIds: number[]): string | null {
  const rule = rules.ruleFor(cls);
  if (rule.kind !== "polymorphic") return rules.readFilter(cls, orgIds);
  const item = itemClassOf(part, rule.classAttr);
  if (!item) throw new ScopeRefusal(cls, "can only be read for one kind of record at a time");
  return rules.readFilter(cls, orgIds, item);
}
