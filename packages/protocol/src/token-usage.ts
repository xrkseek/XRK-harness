/** Provider token meter sample (DSH TokenUsage; Face StatsLine decodeTokens). */

import type { SessionEvent } from "./session-events.js";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
}

function asNonNegInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`TokenUsage.${label} must be a non-negative integer`);
  }
  return value;
}

/** Parse a TokenUsage object; throws on malformed fields. */
export function parseTokenUsage(value: unknown): TokenUsage {
  if (!value || typeof value !== "object") {
    throw new Error("TokenUsage must be an object");
  }
  const o = value as Record<string, unknown>;
  return {
    inputTokens: asNonNegInt(o.inputTokens, "inputTokens"),
    outputTokens: asNonNegInt(o.outputTokens, "outputTokens"),
    ...(o.cacheReadTokens !== undefined
      ? { cacheReadTokens: asNonNegInt(o.cacheReadTokens, "cacheReadTokens") }
      : {}),
    ...(o.cacheWriteTokens !== undefined
      ? {
          cacheWriteTokens: asNonNegInt(o.cacheWriteTokens, "cacheWriteTokens"),
        }
      : {}),
    ...(o.reasoningTokens !== undefined
      ? { reasoningTokens: asNonNegInt(o.reasoningTokens, "reasoningTokens") }
      : {}),
  };
}

/** Soft-parse OpenAI-style usage blobs; returns undefined when unusable. */
export function tryParseOpenAiUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const input = o.prompt_tokens ?? o.input_tokens ?? o.inputTokens;
  const output = o.completion_tokens ?? o.output_tokens ?? o.outputTokens;
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== "number" ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return undefined;
  }
  const usage: TokenUsage = {
    inputTokens: Math.trunc(input),
    outputTokens: Math.trunc(output),
  };
  const cacheRead = o.cache_read_input_tokens ?? o.cacheReadTokens;
  const cacheWrite = o.cache_creation_input_tokens ?? o.cacheWriteTokens;
  const reasoning = o.reasoning_tokens ?? o.reasoningTokens;
  return {
    ...usage,
    ...(typeof cacheRead === "number" &&
    Number.isFinite(cacheRead) &&
    cacheRead >= 0
      ? { cacheReadTokens: Math.trunc(cacheRead) }
      : {}),
    ...(typeof cacheWrite === "number" &&
    Number.isFinite(cacheWrite) &&
    cacheWrite >= 0
      ? { cacheWriteTokens: Math.trunc(cacheWrite) }
      : {}),
    ...(typeof reasoning === "number" &&
    Number.isFinite(reasoning) &&
    reasoning >= 0
      ? { reasoningTokens: Math.trunc(reasoning) }
      : {}),
  };
}

/**
 * Provider sample on mid-stream usage chunk or final assistant message.
 * Only when a concrete `usage` payload is present.
 */
export function providerUsageSample(event: SessionEvent):
  | {
      readonly usage: TokenUsage;
      readonly turnId: string;
      readonly stepId: string;
    }
  | undefined {
  if (
    event.type === "assistant/chunk" &&
    event.kind === "usage" &&
    event.usage !== undefined
  ) {
    return {
      usage: event.usage,
      turnId: event.turnId,
      stepId: event.stepId,
    };
  }
  if (event.type === "assistant/message" && event.usage !== undefined) {
    return {
      usage: event.usage,
      turnId: event.turnId,
      stepId: event.stepId,
    };
  }
  return undefined;
}

/** Same as {@link providerUsageSample} without turn/step ids. */
export function usageFromSessionEvent(
  event: SessionEvent,
): TokenUsage | undefined {
  return providerUsageSample(event)?.usage;
}

/** Input-side occupancy for context pressure (excludes output / reasoning). */
export function inputPressureTokens(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}
