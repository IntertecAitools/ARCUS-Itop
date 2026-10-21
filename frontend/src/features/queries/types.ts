// queries: feature types. Mirror backend/src/platform/queries/queries.service.ts.
import type { Criterion, RecordList } from '@/features/records';

/** One saved query, as the BFF describes it. */
export interface SavedQuery {
  id: number;
  name: string;
  description: string;
  /** The kind of record it lists; "" when the platform has no screens for it. */
  recordType: string;
  recordTypeLabel: string;
  /**
   * `conditions`: a kind of record and conditions. `oql`: only expressible in
   * iTop's query language; administrators edit it as such, anyone may run it.
   */
  mode: 'conditions' | 'oql';
  conditions: Criterion[];
  /** Names of the records key conditions point at, keyed "field:id". */
  valueLabels: Record<string, string>;
  /** Columns to show and export; empty for the record type's own. */
  columns: string[];
  /** The query text, sent to administrators only. */
  oql?: string;
  /** Values it needs from where iTop uses it (a notification), so it cannot run here. */
  parameters: string[];
  runnable: boolean;
  /** One of iTop's predefined queries. */
  template: boolean;
  owner: { id: number; name: string } | null;
  canEdit: boolean;
}

export interface QueryInput {
  name: string;
  description?: string;
  recordType?: string;
  conditions?: Criterion[];
  /** Administrators only. */
  oql?: string;
  columns?: string[];
}

export interface QueryResult extends RecordList {
  recordType: string;
  columns: string[];
}

export interface QueryOptions {
  recordTypes: Array<{ name: string; label: string }>;
}
