/**
 * Every failure from the BFF arrives as one of these, so screens never have to
 * tell a network error apart from a 404 apart from a thrown string.
 */
/**
 * An error as a sentence for the user. A 400 from the BFF's validation
 * carries `details: [{ path, message }]`; those are added, with each path
 * turned into the form's own label when `labels` names it ("Organisation
 * ids: Enter at least one organisation id."), so the user sees which field
 * is wrong, not just "Invalid request body."
 */
export function errorMessage(error: unknown, labels: Record<string, string> = {}): string {
  if (!(error instanceof Error)) return 'Something went wrong.';
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return error.message;
  const fields = (error.details as { path?: unknown; message?: unknown }[])
    .filter((d) => typeof d?.message === 'string')
    .map((d) => {
      const path = typeof d.path === 'string' ? d.path : '';
      const label = labels[path] ?? labels[path.split('.').pop() ?? ''] ?? path;
      return label ? `${label}: ${String(d.message)}` : String(d.message);
    });
  return fields.length ? `${error.message} ${fields.join(' ')}` : error.message;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code = 'unknown_error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** 401/403 — the session, not the request, is the problem. */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }

  /** Worth retrying: transient server or network trouble. */
  get isRetryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}
