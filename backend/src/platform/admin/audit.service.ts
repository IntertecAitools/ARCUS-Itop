import { AppError, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import type { CmdbSchema } from "../../schema/load.js";

/**
 * iTop's data-quality audit, in our vocabulary.
 *
 * iTop keeps it as three classes: an AuditCategory names a set of records (a
 * "definition set" query, e.g. every Server), each AuditRule under it is a
 * query whose results are either the faulty records of that set or the valid
 * ones (`valid_flag`), and AuditDomains group categories. Running a category
 * counts, rule by rule, how many records of the set fail.
 *
 * The counting mirrors iTop's own audit page (pages/audit.php,
 * GetRuleResultFilter): a rule that lists faulty records fails the records it
 * returns that are also in the set; a rule that lists valid records fails every
 * record of the set it does not return. A category's status uses its own
 * tolerances, as AuditCategory::GetReportColor does.
 *
 * No OQL leaves this file: screens see names, record types and results.
 */

/** Failing records listed per rule; the count is always complete. */
export const MAX_RECORDS_PER_RULE = 500;

export type AuditStatus = "good" | "warning" | "bad";

export interface AuditRuleDto {
  id: number;
  name: string;
  description: string;
  /** What the rule's check returns: the faulty records, or the valid ones. */
  lists: "faulty" | "valid";
}

export interface AuditCategoryDto {
  id: number;
  name: string;
  description: string;
  /** The type of record the category checks, e.g. "Server". */
  recordType: string;
  recordTypeLabel: string;
  /** Percent of failing records up to which the result is good, then a warning. */
  tolerance: { good: number; warning: number };
  domains: number[];
  rules: AuditRuleDto[];
}

export interface AuditDomainDto {
  id: number;
  name: string;
  description: string;
  categories: number[];
}

export interface AuditRecord {
  id: number;
  class: string;
  name: string;
}

export interface RuleResult {
  id: number;
  name: string;
  /** Records of the set that fail this rule. */
  failing: number;
  percentOk: number;
  status: AuditStatus;
  records: AuditRecord[];
  /** More records failed than are listed. */
  truncated: boolean;
  /** The check could not be run; nothing was counted. */
  error?: string;
}

export interface CategoryResult {
  id: number;
  name: string;
  ranAt: string;
  /** Records in the category's set. */
  total: number;
  /** Records failing at least one rule. */
  failing: number;
  percentOk: number;
  status: AuditStatus;
  rules: RuleResult[];
  /** The category's set could not be read; no rule was run. */
  error?: string;
}

/**
 * The class a query selects, so core/get can be asked for it: "SELECT Server
 * WHERE …", "SELECT Server AS s JOIN …", or "SELECT s FROM Server AS s …".
 */
export function selectedClass(oql: string): string | null {
  const head = /^\s*SELECT\s+([A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?\s*(FROM\b)?/i.exec(oql);
  if (!head?.[1]) return null;
  if (!head[3]) return head[1];
  // "SELECT alias FROM Class AS alias": find the class behind the alias.
  const alias = head[1];
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)(?:\s+AS)?\s+([A-Za-z_]\w*)/gi;
  for (let m = re.exec(oql); m; m = re.exec(oql)) {
    if (m[2] === alias) return m[1] ?? null;
  }
  return alias;
}

/** Same thresholds as AuditCategory::GetReportColor. */
export function statusFor(total: number, failing: number, tolerance: { good: number; warning: number }): AuditStatus {
  if (total === 0 || failing / total <= tolerance.good / 100) return "good";
  if (failing / total <= tolerance.warning / 100) return "warning";
  return "bad";
}

function percentOk(total: number, failing: number): number {
  return total === 0 ? 100 : Math.round((10_000 * (total - failing)) / total) / 100;
}

const keyOf = (o: { class: string; id: number }) => `${o.class}::${o.id}`;

/**
 * The records of `set` that fail a rule, given what the rule's query returned.
 * Records are compared by their actual class and id, so a rule may select a
 * parent class of the set ("SELECT FunctionalCI …" against every Server).
 */
export function failingRecords(set: FlatObject[], ruleResults: FlatObject[], lists: "faulty" | "valid"): FlatObject[] {
  const returned = new Set(ruleResults.map(keyOf));
  if (lists === "faulty") return set.filter((o) => returned.has(keyOf(o)));
  // iTop: when the rule returns no valid record at all, every record fails.
  return set.filter((o) => !returned.has(keyOf(o)));
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const int = (v: unknown, fallback: number) => {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : fallback;
};

interface CategoryRow {
  dto: AuditCategoryDto;
  definition: string;
  rules: RuleRow[];
}

/** A stored query iTop refused to run; transport faults are not this. */
function queryFailed(error: unknown): boolean {
  return error instanceof AppError && error.code !== "upstream_unavailable" && error.code !== "upstream_timeout";
}

interface RuleRow {
  dto: AuditRuleDto;
  query: string;
}

export class AuditService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
  ) {}

  private async get(cls: string, key: string | number, fields: string): Promise<FlatObject[]> {
    const result = await this.client.call("core/get", { class: cls, key, output_fields: fields });
    return normalizeObjects(result.objects);
  }

  private label(cls: string): string {
    const label = this.schema.get(cls)?.labels.class;
    return label && !label.includes("%") ? label : cls;
  }

  private async domains(): Promise<AuditDomainDto[]> {
    const [domains, links] = await Promise.all([
      this.get("AuditDomain", "SELECT AuditDomain", "name,description"),
      this.get("lnkAuditCategoryToAuditDomain", "SELECT lnkAuditCategoryToAuditDomain", "category_id,domain_id"),
    ]);
    return domains
      .map((d) => ({
        id: d.id,
        name: str(d.fields["name"]),
        description: str(d.fields["description"]),
        categories: links.filter((l) => int(l.fields["domain_id"], 0) === d.id).map((l) => int(l.fields["category_id"], 0)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private toRule(o: FlatObject): RuleRow {
    return {
      dto: {
        id: o.id,
        name: str(o.fields["name"]),
        description: str(o.fields["description"]),
        lists: str(o.fields["valid_flag"]) === "false" ? "faulty" : "valid",
      },
      query: str(o.fields["query"]),
    };
  }

  private async categoryRows(key: string | number, domains: AuditDomainDto[]): Promise<CategoryRow[]> {
    const [categories, rules] = await Promise.all([
      this.get(
        "AuditCategory",
        key,
        "name,description,definition_set,ok_error_tolerance,warning_error_tolerance",
      ),
      this.get(
        "AuditRule",
        typeof key === "number" ? `SELECT AuditRule WHERE category_id = ${key}` : "SELECT AuditRule",
        "name,description,query,valid_flag,category_id",
      ),
    ]);
    return categories
      .map((c) => {
        const definition = str(c.fields["definition_set"]);
        const recordType = selectedClass(definition) ?? "";
        const own = rules
          .filter((r) => int(r.fields["category_id"], 0) === c.id)
          .map((r) => this.toRule(r))
          .sort((a, b) => a.dto.name.localeCompare(b.dto.name));
        return {
          definition,
          rules: own,
          dto: {
            id: c.id,
            name: str(c.fields["name"]),
            description: str(c.fields["description"]),
            recordType,
            recordTypeLabel: recordType ? this.label(recordType) : "",
            tolerance: {
              good: int(c.fields["ok_error_tolerance"], 5),
              warning: int(c.fields["warning_error_tolerance"], 25),
            },
            domains: domains.filter((d) => d.categories.includes(c.id)).map((d) => d.id),
            rules: own.map((r) => r.dto),
          },
        };
      })
      .sort((a, b) => a.dto.name.localeCompare(b.dto.name));
  }

  /** Every domain and category, with each category's rules. */
  async overview(): Promise<{ domains: AuditDomainDto[]; categories: AuditCategoryDto[] }> {
    const domains = await this.domains();
    const categories = await this.categoryRows("SELECT AuditCategory", domains);
    return { domains, categories: categories.map((c) => c.dto) };
  }

  private async category(id: number): Promise<CategoryRow> {
    const [row] = await this.categoryRows(id, []);
    if (!row) throw notFound(`Audit category ${id} not found.`);
    return row;
  }

  /** Records returned by a stored query, read as the signed-in administrator. */
  private async records(oql: string): Promise<FlatObject[]> {
    const cls = selectedClass(oql);
    if (!cls) throw new AppError("bad_request", "Unreadable query.");
    return this.get(cls, oql, "friendlyname");
  }

  private async runRules(category: CategoryRow, rules: RuleRow[]): Promise<CategoryResult> {
    const { dto } = category;
    const base = { id: dto.id, name: dto.name, ranAt: new Date().toISOString() };
    let set: FlatObject[];
    try {
      set = await this.records(category.definition);
    } catch (error) {
      if (!queryFailed(error)) throw error;
      return {
        ...base,
        total: 0,
        failing: 0,
        percentOk: 100,
        status: "bad",
        rules: [],
        error: "The records this category checks could not be read from iTop.",
      };
    }
    const total = set.length;
    const failingKeys = new Set<string>();

    // One rule at a time, as iTop's own audit page does: a category can hold many
    // rules, and firing them all at once loads iTop for no gain an admin would see.
    const runOne = async ({ dto: rule, query }: RuleRow): Promise<RuleResult> => {
      const head = { id: rule.id, name: rule.name };
      if (total === 0) {
        return { ...head, failing: 0, percentOk: 100, status: "good", records: [], truncated: false };
      }
      let returned: FlatObject[];
      try {
        returned = await this.records(query);
      } catch (error) {
        if (!queryFailed(error)) throw error;
        return {
          ...head,
          failing: 0,
          percentOk: 0,
          status: "bad",
          records: [],
          truncated: false,
          error: "This rule's check could not be run in iTop.",
        };
      }
      const failing = failingRecords(set, returned, rule.lists);
      for (const o of failing) failingKeys.add(keyOf(o));
      return {
        ...head,
        failing: failing.length,
        percentOk: percentOk(total, failing.length),
        status: statusFor(total, failing.length, dto.tolerance),
        records: failing
          .slice(0, MAX_RECORDS_PER_RULE)
          .map((o) => ({ id: o.id, class: o.class, name: str(o.fields["friendlyname"]) || `${o.class} ${o.id}` })),
        truncated: failing.length > MAX_RECORDS_PER_RULE,
      };
    };
    const results: RuleResult[] = [];
    for (const rule of rules) results.push(await runOne(rule));

    return {
      ...base,
      total,
      failing: failingKeys.size,
      percentOk: percentOk(total, failingKeys.size),
      status: statusFor(total, failingKeys.size, dto.tolerance),
      rules: results,
    };
  }

  /** Runs every rule of a category. */
  async runCategory(id: number): Promise<CategoryResult> {
    const category = await this.category(id);
    return this.runRules(category, category.rules);
  }

  /** Runs one rule against its category's set. */
  async runRule(id: number): Promise<CategoryResult> {
    const [row] = await this.get("AuditRule", `SELECT AuditRule WHERE id = ${id}`, "category_id");
    if (!row) throw notFound(`Audit rule ${id} not found.`);
    const category = await this.category(int(row.fields["category_id"], 0));
    return this.runRules(category, category.rules.filter((r) => r.dto.id === id));
  }
}
