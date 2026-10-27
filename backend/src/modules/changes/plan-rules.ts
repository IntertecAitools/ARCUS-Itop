import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  ChangePlans,
  ChangeType,
  PlanGate,
  PlanKind,
  PlanRequirement,
  PlanRules,
} from "./changes.types.js";

export const CHANGE_TYPES: ChangeType[] = ["routine", "normal", "emergency"];
export const PLAN_KINDS: PlanKind[] = ["implementation", "rollback", "test"];

/**
 * What a fresh platform asks for: every plan before a normal or emergency
 * change is planned (the CAB judges the plans), only the implementation plan
 * for a routine (pre-approved) one.
 */
export const DEFAULT_PLAN_RULES: PlanRules = {
  routine: { implementation: "plan", rollback: "optional", test: "optional" },
  normal: { implementation: "plan", rollback: "plan", test: "plan" },
  emergency: { implementation: "plan", rollback: "plan", test: "plan" },
};

export const PLAN_LABELS: Record<PlanKind, string> = {
  implementation: "implementation plan",
  rollback: "rollback plan",
  test: "test plan",
};

const REQUIREMENTS: PlanRequirement[] = ["plan", "implement", "optional"];

/** A gate's plans: required at plan counts at implement too. */
export function requiredAt(rule: Record<PlanKind, PlanRequirement>, gate: PlanGate): PlanKind[] {
  return PLAN_KINDS.filter((kind) => rule[kind] === "plan" || (gate === "implement" && rule[kind] === "implement"));
}

export function missingPlans(
  rule: Record<PlanKind, PlanRequirement>,
  plans: ChangePlans,
  gate: PlanGate,
): PlanKind[] {
  return requiredAt(rule, gate).filter((kind) => plans[kind].trim() === "");
}

/** "an implementation plan and a test plan" */
export function listPlans(kinds: PlanKind[]): string {
  const names = kinds.map((k) => PLAN_LABELS[k]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Stored rules, completed from the defaults: a type or plan added later, or
 * a damaged row, never leaves a hole.
 */
export function completeRules(stored: unknown): PlanRules {
  const out = structuredClone(DEFAULT_PLAN_RULES);
  if (!stored || typeof stored !== "object") return out;
  for (const type of CHANGE_TYPES) {
    const row = (stored as Record<string, unknown>)[type];
    if (!row || typeof row !== "object") continue;
    for (const kind of PLAN_KINDS) {
      const value = (row as Record<string, unknown>)[kind];
      if (REQUIREMENTS.includes(value as PlanRequirement)) out[type][kind] = value as PlanRequirement;
    }
  }
  return out;
}

export interface StoredPlanRules {
  rules: PlanRules;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Where the plan rules are kept, one set per tenant ("" without tenancy).
 * iTop has nowhere for them: they are the platform's own configuration.
 */
export interface PlanRuleStore {
  get(tenantId: string): Promise<StoredPlanRules | undefined>;
  save(tenantId: string, rules: PlanRules, updatedBy: string): Promise<void>;
}

/** Tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryPlanRuleStore implements PlanRuleStore {
  private readonly rows = new Map<string, StoredPlanRules>();

  async get(tenantId: string): Promise<StoredPlanRules | undefined> {
    return this.rows.get(tenantId);
  }

  async save(tenantId: string, rules: PlanRules, updatedBy: string): Promise<void> {
    this.rows.set(tenantId, { rules, updatedBy, updatedAt: new Date().toISOString() });
  }
}

/** Table `bff_change_plan_rules` in the BFF's own database, created on first use. */
export class MySqlPlanRuleStore implements PlanRuleStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_change_plan_rules (
           tenant_id VARCHAR(64) NOT NULL,
           rules TEXT NOT NULL,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           updated_by VARCHAR(255) NOT NULL DEFAULT '',
           PRIMARY KEY (tenant_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async get(tenantId: string): Promise<StoredPlanRules | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT rules, updated_at, updated_by FROM bff_change_plan_rules WHERE tenant_id = ?",
      [tenantId],
    );
    const row = rows[0];
    if (!row) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(row["rules"]));
    } catch {
      parsed = undefined;
    }
    const at = row["updated_at"];
    return {
      rules: completeRules(parsed),
      updatedAt: at instanceof Date ? at.toISOString() : String(at ?? ""),
      updatedBy: String(row["updated_by"] ?? ""),
    };
  }

  async save(tenantId: string, rules: PlanRules, updatedBy: string): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_change_plan_rules (tenant_id, rules, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rules = VALUES(rules), updated_by = VALUES(updated_by)`,
      [tenantId, JSON.stringify(rules), updatedBy],
    );
  }
}
