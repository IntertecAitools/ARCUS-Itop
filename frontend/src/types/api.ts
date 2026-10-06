/** Paginated list envelope returned by the BFF */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Error body returned by the BFF for every non-2xx response */
export interface ApiErrorBody {
  code: string;
  message: string;
}

/** Option returned by every lookup endpoint (?q= typeahead) */
export interface LookupOption {
  id: string;
  label: string;
  /** Secondary text, e.g. an email or the org name */
  hint?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  id: string;
  direction: SortDirection;
}
