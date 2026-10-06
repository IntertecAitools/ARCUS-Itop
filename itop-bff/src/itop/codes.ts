import type { ErrorCode } from "../errors.js";

/**
 * Mirrors RestResult's constants in
 * iTop/application/applicationextension/rest/RestResult.php.
 */
export const ItopCode = {
  OK: 0,
  UNAUTHORIZED: 1,
  MISSING_VERSION: 2,
  MISSING_JSON: 3,
  INVALID_JSON: 4,
  MISSING_AUTH_USER: 5,
  MISSING_AUTH_PWD: 6,
  UNSUPPORTED_VERSION: 10,
  UNKNOWN_OPERATION: 11,
  UNSAFE: 12,
  INVALID_PAGE: 13,
  INTERNAL_ERROR: 100,
} as const;

/**
 * Mirrors RestDelete's constants in iTop/core/restservices.class.inc.php.
 * These appear as the per-object `code` inside a core/delete response, NOT as
 * the top-level result code -- do not confuse the two numbering schemes.
 */
export const ItopDeleteCode = {
  OK: 0,
  ISSUE: 1,
  AUTO_DELETE: 2,
  AUTO_DELETE_ISSUE: 3,
  REQUEST_EXPLICITELY: 4,
  AUTO_UPDATE: 5,
  AUTO_UPDATE_ISSUE: 6,
} as const;

export const DELETE_CODE_LABELS: Record<number, string> = {
  0: "deleted",
  1: "cannot be deleted",
  2: "deleted automatically to preserve integrity",
  3: "should be auto-deleted but cannot be",
  4: "must be deleted explicitly",
  5: "external keys reset to preserve integrity",
  6: "should be auto-updated but cannot be",
};

/**
 * The 2/3/4/5/6/10/11 family all mean "the BFF built a malformed request",
 * which is a bug here rather than caller error -- they surface as 500 so they
 * are not silently blamed on the frontend.
 */
const ITOP_CODE_TO_HTTP: Record<number, ErrorCode> = {
  [ItopCode.UNAUTHORIZED]: "forbidden",
  [ItopCode.MISSING_VERSION]: "internal_error",
  [ItopCode.MISSING_JSON]: "internal_error",
  [ItopCode.INVALID_JSON]: "internal_error",
  [ItopCode.MISSING_AUTH_USER]: "unauthorized",
  [ItopCode.MISSING_AUTH_PWD]: "unauthorized",
  [ItopCode.UNSUPPORTED_VERSION]: "internal_error",
  [ItopCode.UNKNOWN_OPERATION]: "internal_error",
  [ItopCode.UNSAFE]: "unsafe_operation",
  [ItopCode.INVALID_PAGE]: "bad_request",
  [ItopCode.INTERNAL_ERROR]: "upstream_error",
};

export function itopCodeToErrorCode(code: number): ErrorCode {
  return ITOP_CODE_TO_HTTP[code] ?? "upstream_error";
}

/**
 * iTop reports "no such object" as INTERNAL_ERROR with a prose message, so the
 * only way to distinguish a genuine 404 from a real upstream fault is to match
 * the message. These strings come from RestUtils::FindObjectFromKey and
 * RestUtils::FindObjectFromCriteria.
 *
 * Matched against the message AFTER cleanMessage() has stripped the "Error: "
 * prefix that rest.php prepends, so these patterns must not expect it.
 */
const NOT_FOUND_PATTERNS: RegExp[] = [
  /^Invalid object\b/i,
  /\bNo item found\b/i,
  /\bNo item found for query\b/i,
  /^Nothing found\b/i,
];

export function looksLikeNotFound(message: string): boolean {
  return NOT_FOUND_PATTERNS.some((re) => re.test(message));
}

/** "Several items found (3) with criteria: ..." means the key was ambiguous. */
export function looksLikeAmbiguous(message: string): boolean {
  return /\bSeveral items found\b/i.test(message);
}
