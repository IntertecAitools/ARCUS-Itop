// records: feature types.

/**
 * Mirrors the BFF's `/api/meta/*` and `/api/objects/*` shapes.
 *
 * This module is deliberately GENERIC: it renders any class iTop has, driven
 * by the schema rather than by hand-written screens. That is what makes the
 * whole of iTop reachable without a bespoke module per class — and it means a
 * datamodel change shows up here with no frontend edit at all.
 */

/** How the BFF categorises a field for rendering. */
export type FieldUi = 'scalar' | 'picker' | 'readonly' | 'related' | 'ignored';

export interface FieldSpec {
  type: string;
  ui: FieldUi;
  required?: boolean;
  /**
   * iTop supplies a value when none is sent, so the caller need not.
   * `required && !hasDefault` is what "the user must fill this" means --
   * Incident marks impact, urgency, priority and status required, and
   * defaults all four.
   */
  hasDefault?: boolean;
  /** Enum choices, when the field has them. */
  values?: string[];
  /** For a picker: the class it points at. */
  target?: string;
  /**
   * For a read-only ExternalField: the picker it is resolved through, and the
   * attribute it reads on the far side. `org_name` is `org_id` -> `name`.
   * These are what let a picker display a name instead of an integer id.
   */
  viaKey?: string;
  viaAttribute?: string;
  /** For a related set: the class on the other end. */
  linked?: string;
  /** False when `linked` is absent from the published schema, so it cannot be listed. */
  linkedAvailable?: boolean;
  /** For a related set: the key on `linked` that points back at this record. */
  linkKey?: string;
  /** For an n-n set: the key on the link class that points at the far side. */
  remoteKey?: string;
  /** How iTop lets the set be edited; absent means add and remove. */
  editMode?: 'none' | 'add_only' | 'add_remove' | 'actions' | 'in_place';
  owner?: string;
}

export interface ClassSummary {
  name: string;
  isCi: boolean;
  abstract: boolean;
  parent: string | null;
  inherits: string[];
  hasLifecycle: boolean;
  counts: { writable: number; readonly: number; related: number; pickers: number };
}

export interface ClassList {
  classes: ClassSummary[];
  groups?: Record<string, string[]>;
}

/**
 * iTop's own form layout: columns, each holding titled fieldsets of ordered
 * fields. Rendering this rather than sorting attribute codes is what makes a
 * generic screen look like iTop's screen for that class.
 */
export interface Fieldset {
  id: string;
  label: string;
  fields: string[];
}

export interface Presentation {
  columns: { id: string; fieldsets: Fieldset[] }[];
  /** The columns iTop shows when listing this class. */
  list: string[];
  /** LinkedSet attributes iTop renders as related-object tabs. */
  related: string[];
}

/** iTop's wording for a class, its fields, its enum values and its actions. */
export interface ClassLabels {
  class: string;
  fields: Record<string, string>;
  values: Record<string, Record<string, string>>;
  stimuli?: Record<string, string>;
}

/** iTop's per-state attribute flags. */
export type StateFlag = 'mandatory' | 'read_only' | 'must_prompt' | 'must_change' | 'hidden';

export interface ClassInfo {
  name: string;
  isCi: boolean;
  abstract: boolean;
  parent: string | null;
  inherits: string[];
  lifecycle: {
    attribute: string;
    states: Record<string, string[]>;
    /**
     * Action ids available on a record of this class. Opaque to the frontend:
     * they are displayed using `labels.stimuli` and sent back as received.
     */
    stimuli: string[];
    /** state -> action -> the state it leads to. */
    transitions: Record<string, Record<string, string>>;
    /** state -> attcode -> iTop's flags for it in that state. */
    flags: Record<string, Record<string, StateFlag[]>>;
  } | null;
  /** Null when iTop declares no layout for the class. */
  presentation: Presentation | null;
  labels: ClassLabels;
  writable: string[];
  readonly: string[];
  related: string[];
  pickers: string[];
  searchable: string[];
  /** Advanced search: per searchable attribute, its kind and operators. */
  criteria?: Record<string, { kind: CriterionKind; ops: CriterionOp[] }>;
  fields: Record<string, FieldSpec>;
}

export interface RecordDto {
  class: string;
  id: number;
  label: string;
  fields: Record<string, unknown>;
}

export interface RecordList {
  items: RecordDto[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
  /** True when the BFF sorted in memory because iTop cannot. */
  sortedInBff: boolean;
}

export interface RecordFilters {
  page: number;
  q?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  /**
   * A navigation view id, e.g. `Incident:OpenIncidents`.
   *
   * The BFF turns it into the OQL iTop declares for that menu. Passing an id
   * rather than a query is what keeps iTop's query language out of the
   * frontend while still letting us render "Open incidents".
   */
  view?: string;
  /** Advanced-search conditions, ANDed with the view and search. */
  criteria?: Criterion[];
}

export interface PickerOption {
  id: number;
  label: string;
}

/** What a delete would do, as the BFF reports iTop's deletion plan. */
export interface DeletePlan {
  simulated: boolean;
  ok: boolean;
  message: string;
  plan: Array<{ class: string; id: number; outcome: string; detail: string }>;
}

/** One field-level change in a record's history, already worded by the BFF. */
export interface HistoryChange {
  kind: string;
  attcode?: string;
  label?: string;
  text: string;
  oldValue?: string;
  newValue?: string;
}

/** One save: who, when, and what it changed. */
export interface HistoryEntry {
  id: string;
  date: string;
  user: string;
  changes: HistoryChange[];
}

export interface HistoryResult {
  items: HistoryEntry[];
  total: number;
  truncated: boolean;
}

/** One action applied to many records, as the bulk endpoint takes it. */
export type BulkRequest =
  | { action: 'update'; ids: number[]; fields: Record<string, unknown> }
  | { action: 'stimulus'; ids: number[]; stimulus: string; fields?: Record<string, unknown> }
  | { action: 'delete'; ids: number[] };

/** Per-record outcome: a bulk action can partly succeed. */
export interface BulkResult {
  results: Array<{ id: number; ok: boolean; error?: string }>;
  succeeded: number;
  failed: number;
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/** What iTop's CSV import did (or, simulated, would do) line by line. */
export interface ImportReport {
  simulated: boolean;
  summary: { issues: number; warnings: number; created: number; updated: number; unchanged: number };
  messages: string[];
  columns: string[];
  rows: Array<{
    line: number;
    kind: 'created' | 'updated' | 'unchanged' | 'error' | 'other';
    status: string;
    class: string;
    id: string;
    cells: string[];
  }>;
}

export interface ImportRequest {
  csv: string;
  simulate: boolean;
  reconciliationKeys?: string[];
  separator?: string;
}

export type CriterionKind = 'string' | 'enum' | 'key' | 'number' | 'date';
export type CriterionOp =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'empty'
  | 'not_empty';

/** One advanced-search condition, in the BFF's vocabulary (never OQL). */
export interface Criterion {
  field: string;
  op: CriterionOp;
  value?: string;
  value2?: string;
  values?: string[];
}

/** The impact-analysis graph around one record. */
export interface RelationGraph {
  root: { class: string; id: number };
  relation: string;
  direction: 'up' | 'down';
  depth: number;
  nodes: Array<{ key: string; class: string; id: number; label: string }>;
  edges: Array<{ from: string; to: string }>;
  message: string;
}
