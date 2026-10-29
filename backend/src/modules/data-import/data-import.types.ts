/**
 * DTOs of the data-import module. Mirrored in
 * frontend/src/features/data-import/types.ts -- keep the two identical.
 */

/** A class the import wizard loads, with the keys it matches on by default. */
export interface ImportClass {
  name: string;
  label: string;
  /** Column targets that identify an existing record, e.g. ["email"] or ["name", "org_id->name"]. */
  defaultKeys: string[];
}

/** A spreadsheet or CSV read into rows of text. */
export interface UploadedTable {
  fileName: string;
  /** The sheet read, for a workbook. */
  sheet?: string;
  headings: string[];
  rows: string[][];
}

/**
 * What to load: the file's rows, where each of its columns goes, and how a
 * row finds the record it updates.
 *
 * A column target is an attribute code (`name`, `org_id` as an id), or a
 * reference matched on a field of the record it points at (`org_id->name`,
 * `manager_id->email`). `id` updates a record by its id.
 */
export interface ImportRequest {
  fileName?: string;
  /** One entry per file column, in file order; null skips it. */
  columns: (string | null)[];
  rows: string[][];
  /** Column targets a row is matched on; none = create every row. */
  keys: string[];
  comment?: string;
}

export type PlannedAction = "create" | "update" | "unchanged" | "error";

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface PlannedRow {
  /** The line in the file: the heading is line 1. */
  line: number;
  action: PlannedAction;
  /** The record a row updates (or leaves unchanged). */
  id?: number;
  /** The row's key values, for display: "email=ann@x.com". */
  key: string;
  changes: FieldChange[];
  errors: string[];
}

export interface ImportSummary {
  create: number;
  update: number;
  unchanged: number;
  error: number;
}

/** The dry run: what running the import would do, row by row. Nothing is written. */
export interface ImportPlan {
  className: string;
  /** The mapped column targets, in file order. */
  columns: string[];
  keys: string[];
  summary: ImportSummary;
  rows: PlannedRow[];
}

export type RowOutcome = "created" | "updated" | "unchanged" | "error";

export interface ReportRow {
  line: number;
  outcome: RowOutcome;
  id?: number;
  key: string;
  changes: FieldChange[];
  errors: string[];
}

export interface ImportReportSummary {
  created: number;
  updated: number;
  unchanged: number;
  error: number;
}

/** A finished import, kept so it can be read and downloaded later. */
export interface ImportReport {
  id: string;
  className: string;
  fileName: string;
  startedAt: string;
  finishedAt: string;
  by: string;
  summary: ImportReportSummary;
  rows: ReportRow[];
}

export type ImportReportListItem = Omit<ImportReport, "rows">;

// ---------------------------------------------------------------------------
// Sync sources: iTop's Data Synchro (SynchroDataSource)
// ---------------------------------------------------------------------------

export type SyncStatus = "implementation" | "production" | "obsolete";
export type ReconciliationPolicy = "use_attributes" | "use_primary_key";
export type DeletePolicy = "ignore" | "delete" | "update" | "update_then_delete";

export interface SyncLogSummary {
  id: number;
  startDate: string;
  endDate: string;
  /** iTop's: running, completed, error. */
  status: string;
  replicasSeen: number;
  replicasTotal: number;
  created: number;
  updated: number;
  deleted: number;
  obsoleted: number;
  /** Creation, update, deletion and reconciliation errors added up. */
  errors: number;
  lastError: string;
}

export interface SyncLog extends SyncLogSummary {
  /** iTop's trace of the run, when its synchro_trace setting is on. */
  traces: string;
}

export interface SyncAttribute {
  attcode: string;
  /** The feed writes this attribute. */
  update: boolean;
  /** The attribute is one the feed's rows are matched on. */
  reconcile: boolean;
  /** master_locked, master_unlocked or write_if_empty. */
  updatePolicy: string;
  /** For a reference: the field of the target its values are matched on ("" = by id). */
  lookup?: string;
}

export interface SyncSource {
  id: number;
  name: string;
  description: string;
  status: SyncStatus;
  targetClass: string;
  reconciliationPolicy: ReconciliationPolicy;
  actionOnZero: "create" | "error";
  actionOnOne: "update" | "error";
  actionOnMultiple: "take_first" | "create" | "error";
  deletePolicy: DeletePolicy;
  /** For delete policy update: "status:obsolete" style assignments. */
  deletePolicyUpdate: string;
  /** Seconds a vanished record is kept before deletion (update_then_delete). */
  deletePolicyRetention: number;
  /** Seconds between full loads; 0 = not checked. */
  fullLoadPeriodicity: number;
  /** The iTop account the synchro writes as. */
  user: string;
  lastRun?: SyncLogSummary;
}

export interface SyncSourceDetail extends SyncSource {
  attributes: SyncAttribute[];
  logs: SyncLogSummary[];
}

export interface SyncSourceInput {
  name: string;
  description?: string;
  status?: SyncStatus;
  targetClass: string;
  reconciliationPolicy?: ReconciliationPolicy;
  /** Attributes the feed's rows are matched on (use_attributes). */
  keys: string[];
  /** Attributes the feed provides; the rest are left alone. */
  columns: string[];
  /** For a reference column: the field of the target its values are matched on. */
  lookups?: Record<string, string>;
  actionOnZero?: "create" | "error";
  actionOnOne?: "update" | "error";
  actionOnMultiple?: "take_first" | "create" | "error";
  deletePolicy?: DeletePolicy;
  deletePolicyUpdate?: string;
  deletePolicyRetention?: number;
  fullLoadPeriodicity?: number;
}

export interface SyncRunRequest {
  /** One entry per file column: `primary_key`, an attribute code, or null to skip it. */
  columns: (string | null)[];
  rows: string[][];
  /** Load and synchronize, then roll everything back. */
  simulate: boolean;
}

export interface SyncRunResult {
  simulated: boolean;
  /** iTop's counts, by its own wording ("Objects created": 3). */
  counts: Record<string, number>;
  /** Per-row remarks and errors from the load phase. */
  messages: string[];
  /** The SynchroLog this run wrote; none for a simulation. */
  log?: SyncLogSummary;
}
