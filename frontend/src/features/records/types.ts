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
  } | null;
  /** Null when iTop declares no layout for the class. */
  presentation: Presentation | null;
  labels: ClassLabels;
  writable: string[];
  readonly: string[];
  related: string[];
  pickers: string[];
  searchable: string[];
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
}

export interface PickerOption {
  id: number;
  label: string;
}
