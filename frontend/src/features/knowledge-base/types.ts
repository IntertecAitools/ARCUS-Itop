/** iTop KnownError.domain */
export type KnownErrorDomain = 'Network' | 'Server' | 'Application' | 'Desktop';

/** lnkErrorToFunctionalCI */
export interface KnownErrorCi {
  functionalci_id: string;
  functionalci_name: string;
  reason: string;
}

/** lnkDocumentToError */
export interface KnownErrorDocument {
  document_id: string;
  document_name: string;
}

export interface KnownErrorSummary {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  problem_id: string | null;
  problem_ref: string | null;
  error_code: string;
  domain: KnownErrorDomain;
  vendor: string;
  model: string;
  version: string;
}

export interface KnownError extends KnownErrorSummary {
  symptom: string;
  root_cause: string;
  workaround: string;
  solution: string;
  ci_list: KnownErrorCi[];
  document_list: KnownErrorDocument[];
}

export interface KnownErrorFilters {
  q?: string;
  domain?: KnownErrorDomain;
  problemId?: string;
  page: number;
  pageSize: number;
}

/** Body of POST /known-errors and PATCH /known-errors/:id */
export interface KnownErrorInput {
  name: string;
  org_id: string;
  problem_id: string | null;
  symptom: string;
  root_cause: string;
  workaround: string;
  solution: string;
  error_code: string;
  domain: KnownErrorDomain;
  vendor: string;
  model: string;
  version: string;
  ci_list: Array<{ functionalci_id: string; reason: string }>;
}
