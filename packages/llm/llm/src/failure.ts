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

const REGION_RE =
  /RegionError|not available in your country|unavailable in (?:your|this) (?:country|region)/i;

const PROVIDER_DENIED_RE =
  /FreeTierError|free tier can only be used|only be used from within OpenCode|trains on request data/i;

const AUTH_BODY_RE =
  /invalid(?:\s+\w+)?\s+(?:api[_\s-]?key|credential)|authentication|unauthorized|AuthError|invalid credential/i;

export function isQuotaExceededError(detail: string): boolean {
  return QUOTA_RE.test(detail);
}

/**
 * Policy / auth codes from OpenCode (and similar) type+message text.
 * Used by HTTP status mapping and openai-compatible wire-error frames.
 */
export function providerPolicyErrorCode(
  detail: string,
): "REGION" | "PROVIDER_DENIED" | "AUTH" | undefined {
  if (REGION_RE.test(detail)) return "REGION";
  if (PROVIDER_DENIED_RE.test(detail)) return "PROVIDER_DENIED";
  if (AUTH_BODY_RE.test(detail)) return "AUTH";
  return undefined;
}

/**
 * Prefer nested provider `error.message` over a raw JSON dump for UI / logs.
 * Understands OpenAI `{ error: { message } }` and OpenCode
 * `{ type, error: { type, message } }`.
 */
export function extractHttpErrorDetail(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const root = json as Record<string, unknown>;
      const err = root.error;
      if (typeof err === "string" && err.trim()) return err.trim();
      if (err && typeof err === "object" && !Array.isArray(err)) {
        const msg = (err as { message?: unknown }).message;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
      }
      if (typeof root.message === "string" && root.message.trim()) {
        return root.message.trim();
      }
    }
  } catch {
    /* not JSON */
  }
  return trimmed.slice(0, 800);
}

/**
 * Map HTTP status (+ optional body text) to a stable LlmError code.
 * CV DSH `llm-deepseek/adapter.httpErrorCode`, refined: 403 is not always AUTH
 * (OpenCode RegionError / FreeTier must not become "API key is invalid").
 */
export function httpErrorCode(status: number, bodyText = ""): string {
  if (status === 401) return "AUTH";
  if (status === 403) {
    return providerPolicyErrorCode(bodyText) ?? "FORBIDDEN";
  }
  if (status === 413) return "INVALID_REQUEST";
  if (isQuotaExceededError(bodyText)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    // OpenCode MissingSessionID and similar are request-shape, not auth.
    const policy = providerPolicyErrorCode(bodyText);
    if (policy === "AUTH") return "AUTH";
    return "INVALID_REQUEST";
  }
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
    headers.get("x-request-id") ??
    headers.get("x-deepseek-request-id") ??
    headers.get("cf-ray") ??
    headers.get("x-amzn-requestid") ??
    headers.get("x-amz-request-id");
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
  const detail = extractHttpErrorDetail(bodyText);
  const providerRetryAfterMs = headers
    ? parseRetryAfterMs(headers.get("retry-after"))
    : undefined;
  const requestId = headers ? requestIdFromHeaders(headers) : undefined;
  const idSuffix =
    requestId !== undefined ? ` [request-id=${requestId}]` : "";
  const detailPart = detail ? `: ${detail.slice(0, 800)}` : "";
  throw new LlmError(
    `${label} HTTP ${status}${detailPart}${idSuffix}`,
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

/**
 * `AbortSignal.abort({ kind: "user" })` (and parent / disposed / hook) stores
 * a plain cancel cause as `signal.reason`. `throwIfAborted()` and some fetch
 * stacks rethrow that object — not a DOMException — so adapters must not
 * classify it as TRANSPORT (which the retry policy then retries as if the
 * model flake).
 */
export function isAgentCancelCause(value: unknown): boolean {
  if (value === null || typeof value !== "object" || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (
    kind === "user" ||
    kind === "parent" ||
    kind === "disposed" ||
    kind === "legacy"
  ) {
    return true;
  }
  return (
    kind === "hook" &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}

function formatAgentCancelCause(value: {
  readonly kind: string;
  readonly reason?: string;
}): string {
  switch (value.kind) {
    case "user":
      return "aborted by user";
    case "parent":
      return "aborted by parent";
    case "disposed":
      return "aborted: session disposed";
    case "hook":
      return `aborted by hook: ${value.reason ?? ""}`;
    default:
      return "aborted";
  }
}

/**
 * Human-readable text for an unknown throw. Plain `String(err)` collapses
 * plain objects to `[object Object]`, which then shows up in the retry
 * disclosure as `anthropic: [object Object]`. Prefer Error.message, then
 * `cause`, then JSON, then a stable fallback — never leave the UI with that
 * opaque token.
 */
export function describeUnknownError(err: unknown): string {
  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed === "" || trimmed === "[object Object]"
      ? "unknown error"
      : trimmed;
  }
  if (isAgentCancelCause(err)) {
    return formatAgentCancelCause(err as { kind: string; reason?: string });
  }
  if (err instanceof Error) {
    const message = err.message.trim();
    if (message !== "" && message !== "[object Object]") return message;
    if (err.cause !== undefined) {
      const cause = describeUnknownError(err.cause);
      if (cause !== "unknown error") return cause;
    }
    return err.name.trim() || "Error";
  }
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim() !== "") {
      return record.message.trim();
    }
    try {
      const json = JSON.stringify(err);
      if (json !== undefined && json !== "{}" && json !== "null") return json;
    } catch {
      /* circular / BigInt — fall through */
    }
  }
  const fallback = String(err);
  return fallback === "[object Object]" ? "unknown error" : fallback;
}

/** Classify a caught transport / abort error into LlmError when possible. */
export function classifyCaughtLlmError(err: unknown, label: string): never {
  if (err instanceof LlmError) throw err;
  if (err instanceof DOMException && err.name === "AbortError") {
    throw new LlmError(`${label}: aborted`, "ABORTED", { cause: err });
  }
  // Node abort with typed reason: fetch / throwIfAborted may surface the
  // plain `{ kind: "user" }` object. Map to ABORTED so Stop never schedules
  // llm/retry (TRANSPORT would burn the 1/N…N/N backoff UI).
  if (isAgentCancelCause(err)) {
    throw new LlmError(
      `${label}: ${formatAgentCancelCause(err as { kind: string; reason?: string })}`,
      "ABORTED",
      { cause: err },
    );
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    throw new LlmError(`${label}: timeout`, "TIMEOUT", { cause: err });
  }
  const message = describeUnknownError(err);
  if (/\btimeout\b/i.test(message)) {
    throw new LlmError(`${label}: ${message}`, "TIMEOUT", { cause: err });
  }
  throw new LlmError(
    `${label}: ${message}`,
    "TRANSPORT",
    err instanceof Error ? { cause: err } : undefined,
  );
}
