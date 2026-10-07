/**
 * Error model.
 *
 * iTop answers every REST call with HTTP 200 and puts the real outcome in the
 * body's `code` field, so the BFF is the layer that turns that back into
 * meaningful HTTP status codes. See ITOP_CODE_TO_HTTP below.
 */

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unsafe_operation"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "upstream_error"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unsafe_operation: 409,
  upstream_unavailable: 502,
  upstream_timeout: 504,
  upstream_error: 502,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** The raw iTop result code, when the error originated upstream. */
  readonly itopCode?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; itopCode?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options.details !== undefined) this.details = options.details;
    if (options.itopCode !== undefined) this.itopCode = options.itopCode;
  }

  toPayload(): { error: { code: ErrorCode; message: string; itopCode?: number; details?: unknown } } {
    const error: { code: ErrorCode; message: string; itopCode?: number; details?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.itopCode !== undefined) error.itopCode = this.itopCode;
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("bad_request", message, { details });

export const notFound = (message: string) => new AppError("not_found", message);
