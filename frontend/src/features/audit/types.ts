/** iTop's data-quality audit, as the BFF presents it (no queries). */

export type AuditStatus = 'good' | 'warning' | 'bad';

export interface AuditRule {
  id: number;
  name: string;
  description: string;
  /** What the rule's check returns: the faulty records, or the valid ones. */
  lists: 'faulty' | 'valid';
}

export interface AuditCategory {
  id: number;
  name: string;
  description: string;
  recordType: string;
  recordTypeLabel: string;
  tolerance: { good: number; warning: number };
  domains: number[];
  rules: AuditRule[];
}

export interface AuditDomain {
  id: number;
  name: string;
  description: string;
  categories: number[];
}

export interface AuditOverview {
  domains: AuditDomain[];
  categories: AuditCategory[];
}

export interface AuditRecord {
  id: number;
  class: string;
  name: string;
}

export interface RuleResult {
  id: number;
  name: string;
  failing: number;
  percentOk: number;
  status: AuditStatus;
  records: AuditRecord[];
  truncated: boolean;
  error?: string;
}

export interface CategoryResult {
  id: number;
  name: string;
  ranAt: string;
  total: number;
  failing: number;
  percentOk: number;
  status: AuditStatus;
  rules: RuleResult[];
  error?: string;
}

/** What the screen remembers of the runs so far. */
export interface CategoryRun {
  ranAt: string;
  total: number;
  /** Set only by a run of the whole category: one rule says nothing about the rest. */
  summary?: { failing: number; percentOk: number; status: AuditStatus };
  error?: string;
  rules: Record<number, RuleResult & { ranAt: string }>;
}

export type AuditRuns = Record<number, CategoryRun>;
