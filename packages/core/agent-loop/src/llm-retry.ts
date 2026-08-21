/**
 * Step-scoped LLM invoke with durable llm/retry events (DSH llm-retry subset).
 */
import {
  cancellableDelay,
  computeRetryDelayMs,
  DEFAULT_RETRY_POLICY,
  failureFromUnknown,
  isContextOverflowError,
  isRetryableFailure,
  type LlmChatResponse,
  type ResolvedRetryPolicy,
} from "@xrkseek/llm";
import type { SessionStore } from "@xrkseek/core-session";
import type { TokenUsage } from "@xrkseek/protocol";
import type { AssembledRequest } from "@xrkseek/core-system-prompt";
import { isAbortError } from "./cancel-finalize.js";

export type ChunkSink = (chunk: {
  kind: "text" | "reasoning" | "usage" | "tool-call";
  index: number;
  text: string;
  usage?: TokenUsage;
  toolCallId?: string;
  toolName?: string;
  argumentsDelta?: string;
}) => void;

export function resolveRetryPolicy(
  option: false | Partial<ResolvedRetryPolicy> | undefined,
): ResolvedRetryPolicy | false {
  if (option === false) return false;
  if (option === undefined) return DEFAULT_RETRY_POLICY;
  return {
    ...DEFAULT_RETRY_POLICY,
    ...option,
    retryableCodes:
      option.retryableCodes ?? DEFAULT_RETRY_POLICY.retryableCodes,
  };
}

export async function invokeLlmWithRetry(input: {
  readonly invoke: (
    onChunk: ChunkSink,
  ) => Promise<LlmChatResponse>;
  readonly flushChunk: ChunkSink;
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepId: string;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  readonly policy: ResolvedRetryPolicy | false;
  readonly provider?: string;
  readonly random?: () => number;
}): Promise<LlmChatResponse> {
  const policy = input.policy;
  let attempt = 0;
  for (;;) {
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const buffered: Parameters<ChunkSink>[0][] = [];
    try {
      const response = await input.invoke((chunk) => {
        buffered.push(chunk);
      });
      for (const chunk of buffered) input.flushChunk(chunk);
      return response;
    } catch (err) {
      if (isAbortError(err, input.signal)) {
        // Cancel finalize needs the streamed prefix in the session log.
        for (const chunk of buffered) input.flushChunk(chunk);
        throw err;
      }
      // Overflow has its own prune/compact path outside retry.
      if (isContextOverflowError(err)) throw err;
      if (policy === false) throw err;
      const failure = failureFromUnknown(err);
      if (!isRetryableFailure(failure, policy)) throw err;
      attempt += 1;
      if (policy.mode === "normal" && attempt > policy.maxRetries) {
        throw err;
      }
      const delayMs = computeRetryDelayMs(
        policy,
        attempt,
        failure,
        input.random ?? Math.random,
      );
      const retryId = `retry_${Math.random().toString(36).slice(2, 10)}`;
      input.store.append(input.sessionId, {
        type: "llm/retry",
        ts: input.now(),
        turnId: input.turnId,
        stepId: input.stepId,
        retryId,
        retry: attempt,
        ...(policy.mode === "normal"
          ? { maxRetries: policy.maxRetries }
          : {}),
        delayMs,
        mode: policy.mode,
        failure: {
          message: failure.message,
          code: failure.code,
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          ...(failure.providerRetryAfterMs !== undefined
            ? { providerRetryAfterMs: failure.providerRetryAfterMs }
            : {}),
        },
        ...(input.provider ? { provider: input.provider } : {}),
      });
      const ok = await cancellableDelay(delayMs, input.signal);
      if (!ok) {
        throw new DOMException("aborted", "AbortError");
      }
      input.store.append(input.sessionId, {
        type: "llm/retry-started",
        ts: input.now(),
        turnId: input.turnId,
        stepId: input.stepId,
        retryId,
        retry: attempt,
      });
      // Discard buffered chunks from the failed attempt (DSH).
    }
  }
}

// Satisfy unused import lint when AssembledRequest is only for typing elsewhere.
export type { AssembledRequest };
