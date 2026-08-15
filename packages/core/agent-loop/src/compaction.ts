/**
 * Run LLM summarizer and append `context/compaction` (window swap).
 */

import {
  DEFAULT_COMPACTION_KEEP_TOKENS,
  prepareCompactionPayload,
  type CompactionOptions,
} from "@xrkseek/core-session";
import type { SessionStore } from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import type {
  CompactionReason,
  ContextCompactionEvent,
} from "@xrkseek/protocol";

export interface RunCompactionInput {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly llm: LlmAdapter;
  readonly reason: CompactionReason;
  readonly keepTokens?: number;
  readonly turnId?: string;
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
  const events = input.store.get(input.sessionId).events;
  const payload = prepareCompactionPayload(events, keep);
  if (!payload) return { compacted: false };

  const response = await input.llm.chat({
    messages: [{ role: "user", content: payload.prompt }],
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const summary = response.content.trim();
  if (!summary) return { compacted: false };

  const event: ContextCompactionEvent = {
    type: "context/compaction",
    ts: (input.now ?? Date.now)(),
    reason: input.reason,
    summary,
    recent: payload.recent,
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
  };
}
