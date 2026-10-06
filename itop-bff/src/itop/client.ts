import { AppError } from "../errors.js";
import type { Config } from "../config.js";
import { ItopCode, itopCodeToErrorCode, looksLikeAmbiguous, looksLikeNotFound } from "./codes.js";
import { cleanMessage } from "./normalize.js";
import type { ItopResult, ItopVerb } from "./types.js";

/**
 * Verbs with no side effects, so a transport-level failure can be retried
 * safely. Writes are never retried: rest.php has already executed DBInsert by
 * the time a response could be lost, and a retry would duplicate the object.
 */
const IDEMPOTENT_VERBS: ReadonlySet<string> = new Set<ItopVerb>([
  "core/get",
  "core/get_related",
  "core/check_credentials",
  "list_operations",
]);

/**
 * HTTP statuses worth another attempt. A 500 means a PHP fatal and a 4xx means
 * the request or URL is wrong, so neither improves on retry.
 */
const RETRIABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);

export interface CallOptions {
  /** Overrides the retry budget for this call. */
  retries?: number;
  signal?: AbortSignal;
}

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const NOOP_LOGGER: Logger = { debug: () => {}, warn: () => {}, error: () => {} };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new AppError("upstream_timeout", "Request aborted."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppError("upstream_timeout", "Request aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ItopClient {
  private readonly cfg: Config["itop"];
  private readonly log: Logger;

  constructor(config: Config, logger: Logger = NOOP_LOGGER) {
    this.cfg = config.itop;
    this.log = logger;
  }

  /**
   * Issues one REST call and returns the parsed body.
   *
   * Throws AppError for transport failures, malformed responses, and any
   * non-zero iTop result code. Callers that need to inspect a non-zero code
   * themselves (core/delete simulation, for instance) should use callRaw.
   */
  async call<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<T> {
    const result = await this.callRaw<T>(verb, params, options);
    if (result.code !== ItopCode.OK) {
      throw this.toAppError(verb, result);
    }
    return result;
  }

  /** Like call(), but returns non-zero result codes instead of throwing. */
  async callRaw<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<T> {
    const payload = { operation: verb, ...params };
    const body = new URLSearchParams({
      version: this.cfg.version,
      auth_user: this.cfg.user,
      auth_pwd: this.cfg.password,
      json_data: JSON.stringify(payload),
    });

    const maxAttempts =
      1 + (IDEMPOTENT_VERBS.has(verb) ? (options.retries ?? this.cfg.retries) : 0);

    let lastError: AppError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attempt<T>(verb, body, options.signal);
      } catch (error) {
        // Application-level failures are deterministic; only transport faults
        // are worth another attempt.
        const retriable =
          error instanceof AppError &&
          (error.code === "upstream_unavailable" || error.code === "upstream_timeout");
        if (!retriable || attempt === maxAttempts) throw error;

        lastError = error;
        const backoffMs = Math.min(250 * 2 ** (attempt - 1), 2_000);
        this.log.warn(
          { verb, attempt, maxAttempts, backoffMs, reason: error.message },
          "iTop call failed, retrying",
        );
        await sleep(backoffMs, options.signal);
      }
    }

    /* c8 ignore next -- the loop either returns or throws */
    throw lastError ?? new AppError("internal_error", "Retry loop exited unexpectedly.");
  }

  private async attempt<T extends ItopResult>(
    verb: ItopVerb,
    body: URLSearchParams,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(this.cfg.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
        },
        body,
        signal,
        redirect: "follow",
      });
    } catch (error) {
      // AbortSignal.timeout surfaces as TimeoutError; a caller abort as AbortError.
      const name = (error as { name?: string } | null)?.name;
      if (name === "TimeoutError") {
        throw new AppError(
          "upstream_timeout",
          `iTop did not respond within ${this.cfg.timeoutMs}ms (${verb}).`,
          { cause: error },
        );
      }
      if (name === "AbortError") {
        throw new AppError("upstream_timeout", `Request cancelled (${verb}).`, { cause: error });
      }
      throw new AppError(
        "upstream_unavailable",
        `Cannot reach iTop at ${this.cfg.endpoint}: ${(error as Error).message}`,
        { cause: error },
      );
    }

    const text = await response.text();
    this.log.debug(
      { verb, status: response.status, ms: Date.now() - startedAt, bytes: text.length },
      "iTop call complete",
    );

    // rest.php always answers 200 for application errors, so a non-2xx status
    // means the web server itself failed -- a PHP fatal, a 401 from Apache, a
    // misconfigured path, or a gateway in front of iTop.
    if (!response.ok) {
      throw new AppError(
        // Gateway and throttling statuses are transient and worth another
        // attempt; a 500 (PHP fatal) or a 4xx (wrong URL) will just recur.
        RETRIABLE_STATUSES.has(response.status) ? "upstream_unavailable" : "upstream_error",
        `iTop returned HTTP ${response.status} for ${verb}. ` +
          `Check that ${this.cfg.endpoint} is correct and reachable.`,
        { details: truncate(text) },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Typically a PHP warning or an HTML login page printed ahead of the JSON.
      throw new AppError(
        "upstream_error",
        `iTop returned a non-JSON response for ${verb}. This usually means a PHP ` +
          `error or an HTML login page was emitted instead of the REST payload.`,
        { details: truncate(text) },
      );
    }

    if (typeof parsed !== "object" || parsed === null || !("code" in parsed)) {
      throw new AppError("upstream_error", `iTop response for ${verb} has no "code" field.`, {
        details: truncate(text),
      });
    }

    return parsed as T;
  }

  /** Maps an iTop result code plus message onto a meaningful HTTP error. */
  private toAppError(verb: ItopVerb, result: ItopResult): AppError {
    const message = cleanMessage(result.message) || `iTop call ${verb} failed.`;

    if (result.code === ItopCode.INTERNAL_ERROR) {
      // iTop collapses "not found" and "ambiguous key" into INTERNAL_ERROR, so
      // the message is the only signal available.
      if (looksLikeNotFound(message)) {
        return new AppError("not_found", message, { itopCode: result.code });
      }
      if (looksLikeAmbiguous(message)) {
        return new AppError("conflict", message, { itopCode: result.code });
      }
    }

    if (result.code === ItopCode.UNAUTHORIZED) {
      return new AppError(
        "forbidden",
        `${message} (iTop's secure_rest_services defaults to true, so the REST ` +
          `account needs the "REST Services User" profile.)`,
        { itopCode: result.code },
      );
    }

    return new AppError(itopCodeToErrorCode(result.code), message, { itopCode: result.code });
  }

  /** Cheap connectivity + credentials probe for the health endpoint. */
  async checkCredentials(): Promise<boolean> {
    const result = await this.call("core/check_credentials", {
      user: this.cfg.user,
      password: this.cfg.password,
    });
    return result.authorized === true;
  }

  async listOperations(): Promise<{ verb: string; description: string }[]> {
    const result = await this.call("list_operations", {});
    return (result.operations ?? []).map(({ verb, description }) => ({ verb, description }));
  }
}

function truncate(text: string, max = 600): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}
