/**
 * Stable provider failure classification (DSH LlmError / httpErrorCode).
 */
export type LlmFailure = {
  readonly message: string;
  readonly code: string;
  readonly status?: number;
  readonly providerRetryAfterMs?: number;
  readonly requestId?: string;
};

export const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
export const QUOTA_EXCEEDED_CODE = "QUOTA";
export const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";

/** Provider/transport failure with a machine-routable `code`. */
export class LlmError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly providerRetryAfterMs?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    options?: {
      readonly status?: number;
      readonly providerRetryAfterMs?: number;
      readonly requestId?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LlmError";
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.providerRetryAfterMs !== undefined) {
      this.providerRetryAfterMs = options.providerRetryAfterMs;
    }
    if (options?.requestId !== undefined) this.requestId = options.requestId;
  }

  toFailure(): LlmFailure {
    return {
      message: this.message,
      code: this.code,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.providerRetryAfterMs !== undefined
        ? { providerRetryAfterMs: this.providerRetryAfterMs }
        : {}),
      ...(this.requestId !== undefined ? { requestId: this.requestId } : {}),
    };
  }
}

export function isLlmError(err: unknown): boolean {
  return err instanceof LlmError;
}

const QUOTA_RE =
  /\b(?:insufficient[_\s-]?quota|billing|balance|credit|payment|exceeded[_\s-]?your[_\s-]?(?:current[_\s-]?)?quota)\b/i;

export function isQuotaExceededError(detail: string): boolean {
  return QUOTA_RE.test(detail);
}

/**
 * Map HTTP status (+ optional body text) to a stable LlmError code.
 * CV DSH `llm-deepseek/adapter.httpErrorCode`.
 */
export function httpErrorCode(status: number, bodyText = ""): string {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 413) return "INVALID_REQUEST";
  if (isQuotaExceededError(bodyText)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) return "INVALID_REQUEST";
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}

/** Parse `Retry-After` header (seconds or HTTP-date) → milliseconds. */
export function parseRetryAfterMs(
  header: string | null | undefined,
): number | undefined {
  if (!header?.trim()) return undefined;
  const trimmed = header.trim();
  const asInt = Number(trimmed);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.trunc(asInt * 1000);
  }
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return undefined;
  const delta = when - Date.now();
  return delta > 0 ? Math.trunc(delta) : 0;
}

export function requestIdFromHeaders(headers: Headers): string | undefined {
  const value =
    headers.get("x-request-id") ?? headers.get("x-deepseek-request-id");
  if (value === null || value.trim().length === 0) return undefined;
  return value.trim();
}

/**
 * Throw a classified {@link LlmError} for a non-OK HTTP response.
 * Caller should already handle overflow / body-limit special cases.
 */
export function throwHttpLlmError(
  label: string,
  status: number,
  bodyText: string,
  headers?: Headers,
): never {
  const code = httpErrorCode(status, bodyText);
  const providerRetryAfterMs = headers
    ? parseRetryAfterMs(headers.get("retry-after"))
    : undefined;
  const requestId = headers ? requestIdFromHeaders(headers) : undefined;
  throw new LlmError(
    `${label} HTTP ${status}: ${bodyText.slice(0, 800)}`,
    code,
    {
      status,
      ...(providerRetryAfterMs !== undefined
        ? { providerRetryAfterMs }
        : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    },
  );
}

/** Classify a caught transport / abort error into LlmError when possible. */
export function classifyCaughtLlmError(err: unknown, label: string): never {
  if (err instanceof LlmError) throw err;
  if (err instanceof DOMException && err.name === "AbortError") {
    throw new LlmError(`${label}: aborted`, "ABORTED", { cause: err });
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    throw new LlmError(`${label}: timeout`, "TIMEOUT", { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/\btimeout\b/i.test(message)) {
    throw new LlmError(`${label}: ${message}`, "TIMEOUT", { cause: err });
  }
  throw new LlmError(
    `${label}: ${message}`,
    "TRANSPORT",
    err instanceof Error ? { cause: err } : undefined,
  );
}
