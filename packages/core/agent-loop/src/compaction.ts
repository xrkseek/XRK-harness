/**
 * Run LLM summarizer and append `context/compaction` (window swap).
 * Logs `shadowedTokenCount` from the same surface estimator Face meter uses.
 */

import {
  DEFAULT_COMPACTION_KEEP_TOKENS,
  prepareCompactionPayload,
  priceCurrentSurfaceWindow,
  type CompactionOptions,
  type SessionStore,
  readSessionEvents,
} from "@xrkseek/core-session";
import type { LlmAdapter, ResolvedRetryPolicy } from "@xrkseek/llm";
import type {
  CompactionReason,
  ContextCompactionEvent,
} from "@xrkseek/protocol";
import { invokeLlmWithRetry, resolveRetryPolicy } from "./llm-retry.js";

export interface RunCompactionInput {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly llm: LlmAdapter;
  readonly reason: CompactionReason;
  readonly keepTokens?: number;
  readonly turnId?: string;
  /** When set with `turnId` + `retry`, summarizer failures use llm/retry. */
  readonly stepId?: string;
  /**
   * Same policy as the step's main provider call. Omit / `false` → one shot
   * (manual `/compact` and tests).
   */
  readonly retry?: false | Partial<ResolvedRetryPolicy>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export interface RunCompactionResult {
  readonly compacted: boolean;
  readonly event?: ContextCompactionEvent;
}

export async function runCompaction(
  input: RunCompactionInput,
): Promise<RunCompactionResult> {
  const keep = input.keepTokens ?? DEFAULT_COMPACTION_KEEP_TOKENS;
  const events = readSessionEvents(input.store, input.sessionId);
  const payload = prepareCompactionPayload(events, keep);
  if (!payload) return { compacted: false };

  const shadowedTokenCount = priceCurrentSurfaceWindow(events);
  const now = input.now ?? Date.now;

  const invokeChat = async () =>
    input.llm.chat({
      messages: [{ role: "user", content: payload.prompt }],
      ...(input.signal ? { signal: input.signal } : {}),
    });

  // Soft-budget / overflow summarizer used to call llm.chat bare — OFM/free
  // lanes often 502 on tool-less summarizer prompts, and the turn failed with
  // SERVER and zero llm/retry chrome. Reuse the step retry policy when wired.
  const retryPolicy =
    input.retry === undefined ? false : resolveRetryPolicy(input.retry);
  const response =
    retryPolicy !== false &&
    input.turnId !== undefined &&
    input.stepId !== undefined
      ? await invokeLlmWithRetry({
          invoke: async () => invokeChat(),
          flushChunk: () => {
            /* summarizer is non-streaming */
          },
          store: input.store,
          sessionId: input.sessionId,
          turnId: input.turnId,
          stepId: input.stepId,
          now,
          ...(input.signal ? { signal: input.signal } : {}),
          policy: retryPolicy,
          ...(input.llm.id ? { provider: input.llm.id } : {}),
        })
      : await invokeChat();

  const summary = response.content.trim();
  if (!summary) return { compacted: false };

  const event: ContextCompactionEvent = {
    type: "context/compaction",
    ts: now(),
    reason: input.reason,
    summary,
    recent: payload.recent,
    shadowedTokenCount,
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  };
  input.store.append(input.sessionId, event);
  return { compacted: true, event };
}

export function resolveCompactionOptions(
  value: false | CompactionOptions | undefined,
): CompactionOptions | undefined {
  if (value === false || value === undefined) return undefined;
  return {
    auto: value.auto !== false,
    ...(value.maxRequestTokens !== undefined
      ? { maxRequestTokens: value.maxRequestTokens }
      : {}),
    ...(value.keepTokens !== undefined ? { keepTokens: value.keepTokens } : {}),
    ...(value.bufferTokens !== undefined
      ? { bufferTokens: value.bufferTokens }
      : {}),
    ...(value.strategy !== undefined ? { strategy: value.strategy } : {}),
    ...(value.softBudgetTriggerRatio !== undefined
      ? { softBudgetTriggerRatio: value.softBudgetTriggerRatio }
      : {}),
    ...(value.compactRecentMaxTokens !== undefined
      ? { compactRecentMaxTokens: value.compactRecentMaxTokens }
      : {}),
    ...(value.softBudgetPeelAttempts !== undefined
      ? { softBudgetPeelAttempts: value.softBudgetPeelAttempts }
      : {}),
  };
}
