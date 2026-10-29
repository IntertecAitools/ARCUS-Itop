import type { Pool, RowDataPacket } from "mysql2/promise";

import type { AssignmentRule, AssignmentRules, RoutingFacts } from "./dispatch.types.js";

/**
 * The assignment rules: which team a new ticket goes to. iTop has nowhere
 * for them (its "dispatch rules" are a commercial extension), so they are
 * the platform's own configuration, one list per tenant ("" without
 * tenancy), kept like the change plan rules.
 */

export const NO_RULES: AssignmentRules = { rules: [], notifyTeam: false };

/** The first enabled rule whose every set criterion equals the ticket's. */
export function matchRule(rules: readonly AssignmentRule[], facts: RoutingFacts): AssignmentRule | undefined {
  const same = (want: string | undefined, have: string | undefined) => !want || want === have;
  return rules.find(
    (rule) =>
      rule.enabled &&
      same(rule.ticketType, facts.ticketType) &&
      same(rule.organizationId, facts.organizationId) &&
      same(rule.serviceId, facts.serviceId) &&
      same(rule.serviceSubcategoryId, facts.serviceSubcategoryId),
  );
}

/** A stored document as the current shape; anything damaged reads as no rules. */
export function completeRules(stored: unknown): AssignmentRules {
  if (typeof stored !== "object" || stored === null) return structuredClone(NO_RULES);
  const doc = stored as Partial<AssignmentRules>;
  const rules = Array.isArray(doc.rules)
    ? doc.rules.filter((r): r is AssignmentRule => !!r && typeof r.id === "string" && typeof r.teamId === "string")
    : [];
  return { rules, notifyTeam: doc.notifyTeam === true };
}

export interface StoredAssignmentRules {
  rules: AssignmentRules;
  updatedAt: string;
  updatedBy: string;
}

export interface AssignmentRuleStore {
  get(tenantId: string): Promise<StoredAssignmentRules | undefined>;
  save(tenantId: string, rules: AssignmentRules, updatedBy: string): Promise<void>;
}

/** Tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryAssignmentRuleStore implements AssignmentRuleStore {
  private readonly rows = new Map<string, StoredAssignmentRules>();

  async get(tenantId: string): Promise<StoredAssignmentRules | undefined> {
    return this.rows.get(tenantId);
  }

  async save(tenantId: string, rules: AssignmentRules, updatedBy: string): Promise<void> {
    this.rows.set(tenantId, { rules: structuredClone(rules), updatedBy, updatedAt: new Date().toISOString() });
  }
}

/** Table `bff_assignment_rules` in the BFF's own database, created on first use. */
export class MySqlAssignmentRuleStore implements AssignmentRuleStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_assignment_rules (
           tenant_id VARCHAR(64) NOT NULL,
           rules MEDIUMTEXT NOT NULL,
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

  async get(tenantId: string): Promise<StoredAssignmentRules | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT rules, updated_at, updated_by FROM bff_assignment_rules WHERE tenant_id = ?",
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

  async save(tenantId: string, rules: AssignmentRules, updatedBy: string): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_assignment_rules (tenant_id, rules, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rules = VALUES(rules), updated_by = VALUES(updated_by)`,
      [tenantId, JSON.stringify(rules), updatedBy],
    );
  }
}
