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
  /** Enum choices, when the field has them. */
  values?: string[];
  /** For a picker: the class it points at. */
  target?: string;
  /** For a related set: the class on the other end. */
  linked?: string;
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

export interface ClassInfo {
  name: string;
  isCi: boolean;
  abstract: boolean;
  parent: string | null;
  inherits: string[];
  lifecycle: { attribute: string; states: Record<string, string[]> } | null;
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
