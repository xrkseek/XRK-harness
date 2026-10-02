/**
 * Provider request retry policy (DSH llm-retry normal mode subset).
 */
import {
  describeUnknownError,
  isLlmError,
  type LlmError,
  type LlmFailure,
} from "./failure.js";

export type RetryPolicyMode = "normal" | "always";

export interface ResolvedRetryPolicy {
  readonly mode: RetryPolicyMode;
  /** Cap for `normal` mode (ignored when `always`). Default 5. */
  readonly maxRetries: number;
  /** Codes that must NOT be retried; everything else is. */
  readonly nonRetryableCodes: readonly string[];
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Jitter ratio in [0, 1]; default 0.25. */
  readonly jitterRatio: number;
}

/**
 * Retry is a blacklist, not a whitelist: every abnormal failure retries —
 * transport, timeout, 5xx, rate limit, empty body, truncated tool JSON,
 * `UNKNOWN`. Enumerating "definitely not worth another attempt" is a short,
 * closed list; enumerating "worth retrying" means guessing every errno a
 * future Node/undici/Chromium release may invent, and any miss is a silent
 * no-retry. So the policy lists the few codes that are deterministic failures
 * and treats everything else as transient.
 *
 * Note what is deliberately absent: a model hitting its output ceiling is
 * not a failure at all. `finish_reason: length` / `stop_reason: max_tokens`
 * map to `finishReason: "max-tokens"` on a *successful* response and never
 * raise, so normal truncation never reaches this predicate — no blacklist
 * entry is needed for it. The only finish that throws is `ProviderFinishError`
 * (`finishReason: "error"`, an unknown wire stop), and that is an abnormal
 * stop, so it retries.
 */
export const DEFAULT_NON_RETRYABLE_CODES = [
  // User cancel / parent dispose: retrying ignores the stop.
  "ABORTED",
  // 401/403 — bad key or missing permission. Same request, same rejection.
  "AUTH",
  // Out of credit / quota exhausted. Retrying only spends more money.
  "QUOTA",
  // 400/413 — malformed request or oversized body; the request must change.
  "INVALID_REQUEST",
  // Context window blown; agent-loop routes this to prune/compact instead.
  "CONTEXT_WINDOW_EXCEEDED",
  // Deployment-locked effort, rejected before provider I/O.
  "UNSUPPORTED_REASONING_EFFORT",
  // Modality or request size the active route cannot serve, ever.
  "UNSUPPORTED_CONTENT",
] as const;

export const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  mode: "normal",
  maxRetries: 5,
  nonRetryableCodes: [...DEFAULT_NON_RETRYABLE_CODES],
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.25,
};

function errorCode(err: unknown): string | undefined {
  if (isLlmError(err)) return (err as LlmError).code;
  // A cancel is control flow, not a failure: it carries no `code`, so it would
  // read as UNKNOWN and burn the full retry budget after the user hit stop.
  // Same DOMException rule `classifyCaughtLlmError` uses.
  if (err instanceof DOMException && err.name === "AbortError") return "ABORTED";
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return undefined;
}

export function failureFromUnknown(err: unknown): LlmFailure {
  if (isLlmError(err)) return (err as LlmError).toFailure();
  // Prefer a real message over `String(plainObject)` → `[object Object]`,
  // which otherwise lands verbatim in the llm/retry disclosure.
  return {
    message: describeUnknownError(err),
    code: errorCode(err) ?? "UNKNOWN",
  };
}

export function isRetryableFailure(
  failure: LlmFailure,
  policy: ResolvedRetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  if (policy.mode === "always") return true;
  return !policy.nonRetryableCodes.includes(failure.code);
}

export function computeRetryDelayMs(
  policy: ResolvedRetryPolicy,
  retry: number,
  failure?: LlmFailure,
  random: () => number = Math.random,
): number {
  if (
    failure?.providerRetryAfterMs !== undefined &&
    failure.providerRetryAfterMs > 0
  ) {
    return Math.min(failure.providerRetryAfterMs, policy.maxDelayMs);
  }
  const exponent = Math.min(Math.max(retry - 1, 0), 1024);
  const exponential = Math.min(
    policy.initialDelayMs * 2 ** exponent,
    policy.maxDelayMs,
  );
  const jitter =
    1 - policy.jitterRatio + 2 * policy.jitterRatio * random();
  return Math.min(exponential * jitter, policy.maxDelayMs);
}

/** Cancellable delay; resolves false when aborted before the timer fires. */
export function cancellableDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}