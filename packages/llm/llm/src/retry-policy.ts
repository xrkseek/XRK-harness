/**
 * Provider request retry policy (DSH llm-retry normal mode subset).
 */
import {
  isLlmError,
  type LlmError,
  type LlmFailure,
} from "./failure.js";

export type RetryPolicyMode = "normal" | "always";

export interface ResolvedRetryPolicy {
  readonly mode: RetryPolicyMode;
  /** Cap for `normal` mode (ignored when `always`). Default 5. */
  readonly maxRetries: number;
  readonly retryableCodes: readonly string[];
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Jitter ratio in [0, 1]; default 0.25. */
  readonly jitterRatio: number;
}

export const DEFAULT_RETRYABLE_CODES = [
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
] as const;

export const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  mode: "normal",
  maxRetries: 5,
  retryableCodes: [...DEFAULT_RETRYABLE_CODES],
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.25,
};

function errorCode(err: unknown): string | undefined {
  if (isLlmError(err)) return (err as LlmError).code;
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return undefined;
}

export function failureFromUnknown(err: unknown): LlmFailure {
  if (isLlmError(err)) return (err as LlmError).toFailure();
  const code = errorCode(err);
  if (err instanceof Error) {
    return {
      message: err.message,
      code: code ?? "UNKNOWN",
    };
  }
  return { message: String(err), code: code ?? "UNKNOWN" };
}

export function isRetryableFailure(
  failure: LlmFailure,
  policy: ResolvedRetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  if (policy.mode === "always") return true;
  return policy.retryableCodes.includes(failure.code);
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
