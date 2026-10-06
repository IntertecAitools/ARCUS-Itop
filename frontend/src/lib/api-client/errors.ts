import type { ApiErrorBody } from '@/types';

/** Every failed BFF call surfaces as an ApiError. The global toast shows `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static fromBody(status: number, body: Partial<ApiErrorBody> | undefined, fallback: string): ApiError {
    return new ApiError(status, body?.code ?? `http_${status}`, body?.message ?? fallback);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}
