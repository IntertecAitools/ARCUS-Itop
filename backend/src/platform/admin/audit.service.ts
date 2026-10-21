import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { criterionKind, type Criterion } from "../objects/criteria.js";
import { conditionsToFilter, filterToConditions } from "./conditions.js";

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
 * Editing works in the same vocabulary: a category is a record type plus
 * conditions, a rule is conditions on that record type plus whether the
 * records it matches are faulty or valid. Both are written as OQL with the
 * notification rules' translation (conditions.ts), so any part of a query
 * set up in iTop that cannot be shown is kept as it is unless dropped.
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

/** A category or rule's query as the editor shows it. */
export interface EditableConditions {
  conditions: Criterion[];
  /** Part of the query was set up in iTop and cannot be shown; it is kept unless dropped. */
  keptCondition: boolean;
  /** Names of the records key conditions point at, keyed "field:id". */
  valueLabels: Record<string, string>;
}

export type AuditCategoryForm = AuditCategoryDto & EditableConditions;

export type AuditRuleForm = AuditRuleDto &
  EditableConditions & { categoryId: number; recordType: string; recordTypeLabel: string };

export interface CategoryInput {
  name: string;
  description?: string;
  recordType: string;
  conditions?: Criterion[];
  /** false drops the part of the query set up in iTop. */
  keepCondition?: boolean;
  tolerance?: { good: number; warning: number };
  domains?: number[];
}

export interface RuleInput {
  categoryId: number;
  name: string;
  description?: string;
  lists: "faulty" | "valid";
  conditions?: Criterion[];
  keepCondition?: boolean;
}

export interface DomainInput {
  name: string;
  description?: string;
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

  // --- Editing -------------------------------------------------------------

  /** Record types a category may check: CIs first, then the rest. */
  options(): { recordTypes: Array<{ name: string; label: string; ci: boolean }> } {
    return {
      recordTypes: this.schema
        .list()
        .map((c) => ({ name: c.name, label: this.label(c.name), ci: c.isCi }))
        .sort((a, b) => Number(b.ci) - Number(a.ci) || a.label.localeCompare(b.label)),
    };
  }

  private requireClass(name: string): ClassInfo {
    const info = this.schema.get(name);
    if (!info) throw badRequest(`Unknown kind of record "${name}".`);
    return info;
  }

  /** A stored query against a record type, as conditions and whatever else it held. */
  private parse(info: ClassInfo | undefined, oql: string) {
    if (!oql.trim()) return { conditions: [], kept: [] };
    return info ? filterToConditions(info, oql) : { conditions: [] as Criterion[], kept: [oql] };
  }

  /** Names of the records that key conditions point at, keyed "field:id". */
  private async valueLabels(info: ClassInfo | undefined, conditions: Criterion[]): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    await Promise.all(
      conditions.map(async (c) => {
        const target = info?.fields[c.field]?.target;
        const ids = (c.values ?? []).map(String).filter((v) => /^\d+$/.test(v));
        if (!target || !ids.length) return;
        const rows = await this.get(target, `SELECT ${target} WHERE id IN (${ids.join(",")})`, "friendlyname");
        const names = new Map(rows.map((r) => [String(r.id), str(r.fields["friendlyname"])]));
        for (const id of ids) labels[`${c.field}:${id}`] = names.get(id) || `#${id}`;
      }),
    );
    return labels;
  }

  private async editable(info: ClassInfo | undefined, oql: string): Promise<EditableConditions> {
    const parsed = this.parse(info, oql);
    return {
      conditions: parsed.conditions,
      keptCondition: parsed.kept.length > 0,
      valueLabels: await this.valueLabels(info, parsed.conditions),
    };
  }

  /** A category as its editor shows it. */
  async getCategory(id: number): Promise<AuditCategoryForm> {
    const domains = await this.domains();
    const [row] = await this.categoryRows(id, domains);
    if (!row) throw notFound(`Audit category ${id} not found.`);
    return { ...row.dto, ...(await this.editable(this.schema.get(row.dto.recordType), row.definition)) };
  }

  private async ruleRow(id: number): Promise<{ rule: RuleRow; categoryId: number }> {
    const [row] = await this.get(
      "AuditRule",
      `SELECT AuditRule WHERE id = ${id}`,
      "name,description,query,valid_flag,category_id",
    );
    if (!row) throw notFound(`Audit rule ${id} not found.`);
    return { rule: this.toRule(row), categoryId: int(row.fields["category_id"], 0) };
  }

  /** A rule as its editor shows it, read against its category's record type. */
  async getRule(id: number): Promise<AuditRuleForm> {
    const { rule, categoryId } = await this.ruleRow(id);
    const category = await this.category(categoryId);
    const recordType = this.ruleType(rule.query, category.dto.recordType);
    return {
      ...rule.dto,
      categoryId,
      recordType,
      recordTypeLabel: this.label(recordType),
      ...(await this.editable(this.schema.get(recordType), rule.query)),
    };
  }

  /**
   * The record type a rule's conditions are on: its own query's class when
   * iTop has one we know (a rule may check a parent class of the category's,
   * e.g. every FunctionalCI against every Server), else the category's.
   */
  private ruleType(query: string, categoryType: string): string {
    const own = selectedClass(query);
    return own && this.schema.get(own) ? own : categoryType;
  }

  /** Conditions to a query; conditions on dates are refused, since they cannot be read back. */
  private toQuery(info: ClassInfo, conditions: Criterion[], kept: string[]): string {
    for (const c of conditions) {
      const field = info.fields[c.field];
      if (!field) throw badRequest(`${this.label(info.name)} has no field "${c.field}".`);
      if (criterionKind(field) === "date") throw badRequest("Dates cannot be used in audit conditions.");
    }
    return conditionsToFilter(info, conditions, kept);
  }

  private validateCategory(input: CategoryInput): ClassInfo {
    if (!input.name.trim()) throw badRequest("Give the category a name.");
    const tolerance = input.tolerance;
    if (tolerance && !(tolerance.good >= 0 && tolerance.good <= tolerance.warning && tolerance.warning <= 100)) {
      throw badRequest("Tolerances run from 0 to 100%, the warning one at least as high as the good one.");
    }
    return this.requireClass(input.recordType);
  }

  private categoryFields(input: CategoryInput, info: ClassInfo, kept: string[]): Record<string, unknown> {
    const definition = this.toQuery(info, input.conditions ?? [], input.keepCondition === false ? [] : kept);
    return {
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      definition_set: definition || `SELECT ${info.name}`,
      ...(input.tolerance
        ? { ok_error_tolerance: input.tolerance.good, warning_error_tolerance: input.tolerance.warning }
        : {}),
    };
  }

  /** Checked before anything is written, so an unknown domain saves nothing. */
  private async assertDomains(ids: number[] | undefined): Promise<void> {
    if (!ids?.length) return;
    const known = await this.get("AuditDomain", "SELECT AuditDomain", "name");
    const unknown = ids.filter((id) => !known.some((d) => d.id === id));
    if (unknown.length) throw badRequest(`No audit domain ${unknown.join(", ")}.`);
  }

  /** Links a category to exactly the given domains. */
  private async syncDomains(categoryId: number, wanted: number[], comment: string): Promise<void> {
    const links = await this.get(
      "lnkAuditCategoryToAuditDomain",
      `SELECT lnkAuditCategoryToAuditDomain WHERE category_id = ${categoryId}`,
      "category_id,domain_id",
    );
    const current = links.filter((l) => int(l.fields["category_id"], 0) === categoryId);
    for (const id of new Set(wanted)) {
      if (current.some((l) => int(l.fields["domain_id"], 0) === id)) continue;
      await this.client.call("core/create", {
        class: "lnkAuditCategoryToAuditDomain",
        fields: { category_id: categoryId, domain_id: id },
        output_fields: "id",
        comment,
      });
    }
    for (const link of current.filter((l) => !wanted.includes(int(l.fields["domain_id"], 0)))) {
      await this.client.call("core/delete", { class: "lnkAuditCategoryToAuditDomain", key: link.id, comment });
    }
  }

  async createCategory(input: CategoryInput): Promise<AuditCategoryForm> {
    const info = this.validateCategory(input);
    const comment = "Audit category created in the platform";
    const fields = this.categoryFields(input, info, []);
    await this.assertDomains(input.domains);
    const created = await this.client.call("core/create", {
      class: "AuditCategory",
      fields,
      output_fields: "id",
      comment,
    });
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no category.");
    if (input.domains?.length) await this.syncDomains(row.id, input.domains, comment);
    return this.getCategory(row.id);
  }

  async updateCategory(id: number, input: CategoryInput): Promise<AuditCategoryForm> {
    const info = this.validateCategory(input);
    const current = await this.category(id);
    const kept = this.parse(this.schema.get(current.dto.recordType), current.definition).kept;
    if (input.recordType !== current.dto.recordType) {
      // Rules are conditions on the old record type: they would stop meaning anything.
      if (current.rules.length) {
        throw badRequest("Delete this category's rules before changing the kind of record it checks.");
      }
      if (kept.length && input.keepCondition !== false) {
        throw badRequest("Remove the condition set up in iTop before changing the kind of record.");
      }
    }
    const comment = "Audit category edited in the platform";
    const fields = this.categoryFields(input, info, kept);
    await this.assertDomains(input.domains);
    await this.client.call("core/update", { class: "AuditCategory", key: id, fields, output_fields: "id", comment });
    if (input.domains) await this.syncDomains(id, input.domains, comment);
    return this.getCategory(id);
  }

  /**
   * Deletes a category. Its rules go with it (iTop refuses to delete a
   * category that still has rules), so unless `withRules` is set a category
   * with rules is not deleted and the answer names them. Domain links go too.
   */
  async deleteCategory(id: number, withRules = false): Promise<{ deletedRules: Array<{ id: number; name: string }> }> {
    const category = await this.category(id);
    const rules = category.rules.map((r) => ({ id: r.dto.id, name: r.dto.name }));
    if (rules.length && !withRules) {
      throw new AppError(
        "conflict",
        `“${category.dto.name}” has ${rules.length === 1 ? "1 rule" : `${rules.length} rules`}, deleted with it: ${rules
          .map((r) => r.name)
          .join(", ")}.`,
        { details: { rules } },
      );
    }
    const comment = "Audit category deleted in the platform";
    for (const rule of rules) await this.client.call("core/delete", { class: "AuditRule", key: rule.id, comment });
    await this.client.call("core/delete", { class: "AuditCategory", key: id, comment });
    return { deletedRules: rules };
  }

  private ruleFields(input: RuleInput, info: ClassInfo, kept: string[]): Record<string, unknown> {
    if (!input.name.trim()) throw badRequest("Give the rule a name.");
    const query = this.toQuery(info, input.conditions ?? [], input.keepCondition === false ? [] : kept);
    if (!query) throw badRequest("Add at least one condition: the records it matches are the faulty or the valid ones.");
    return {
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      query,
      valid_flag: input.lists === "valid" ? "true" : "false",
      category_id: input.categoryId,
    };
  }

  async createRule(input: RuleInput): Promise<AuditRuleForm> {
    const category = await this.category(input.categoryId);
    const info = this.requireClass(category.dto.recordType);
    const created = await this.client.call("core/create", {
      class: "AuditRule",
      fields: this.ruleFields(input, info, []),
      output_fields: "id",
      comment: "Audit rule created in the platform",
    });
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no rule.");
    return this.getRule(row.id);
  }

  async updateRule(id: number, input: RuleInput): Promise<AuditRuleForm> {
    const { rule, categoryId } = await this.ruleRow(id);
    const from = await this.category(categoryId);
    const to = input.categoryId === categoryId ? from : await this.category(input.categoryId);
    if (to.dto.recordType !== from.dto.recordType) {
      throw badRequest("A rule can only move to a category that checks the same kind of record.");
    }
    const info = this.requireClass(this.ruleType(rule.query, from.dto.recordType));
    const kept = this.parse(info, rule.query).kept;
    await this.client.call("core/update", {
      class: "AuditRule",
      key: id,
      fields: this.ruleFields(input, info, kept),
      output_fields: "id",
      comment: "Audit rule edited in the platform",
    });
    return this.getRule(id);
  }

  async deleteRule(id: number): Promise<void> {
    await this.ruleRow(id);
    await this.client.call("core/delete", { class: "AuditRule", key: id, comment: "Audit rule deleted in the platform" });
  }

  private domainFields(input: DomainInput): Record<string, unknown> {
    if (!input.name.trim()) throw badRequest("Give the domain a name.");
    return { name: input.name.trim(), description: (input.description ?? "").trim() };
  }

  private async domain(id: number): Promise<AuditDomainDto> {
    const found = (await this.domains()).find((d) => d.id === id);
    if (!found) throw notFound(`Audit domain ${id} not found.`);
    return found;
  }

  async createDomain(input: DomainInput): Promise<AuditDomainDto> {
    const created = await this.client.call("core/create", {
      class: "AuditDomain",
      fields: this.domainFields(input),
      output_fields: "id",
      comment: "Audit domain created in the platform",
    });
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no domain.");
    return this.domain(row.id);
  }

  async updateDomain(id: number, input: DomainInput): Promise<AuditDomainDto> {
    await this.domain(id);
    await this.client.call("core/update", {
      class: "AuditDomain",
      key: id,
      fields: this.domainFields(input),
      output_fields: "id",
      comment: "Audit domain edited in the platform",
    });
    return this.domain(id);
  }

  /** Deletes a domain; its categories stay, only their link to it goes. */
  async deleteDomain(id: number): Promise<void> {
    await this.domain(id);
    await this.client.call("core/delete", { class: "AuditDomain", key: id, comment: "Audit domain deleted in the platform" });
  }
}
