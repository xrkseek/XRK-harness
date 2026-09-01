/** Provider token meter sample (DSH TokenUsage; Face StatsLine decodeTokens). */

import type { SessionEvent } from "./session-events.js";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Exact full-call total (aggregate prompt + output). Omitted when the
   * provider total is unavailable or inconsistent with the known buckets.
   */
  readonly totalTokens?: number;
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
    ...(o.totalTokens !== undefined
      ? { totalTokens: asNonNegInt(o.totalTokens, "totalTokens") }
      : {}),
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

/** Soft-parse OpenAI-style usage blobs; returns undefined when unusable.
 *
 * Wire `prompt_tokens` often **includes** cache hits (DeepSeek:
 * `prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`).
 * Harness {@link TokenUsage} keeps **disjoint** buckets, so cache reads are
 * subtracted from `inputTokens` (DSH `mapUsage`).
 */
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

  const details =
    o.prompt_tokens_details &&
    typeof o.prompt_tokens_details === "object" &&
    !Array.isArray(o.prompt_tokens_details)
      ? (o.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  const completionDetails =
    o.completion_tokens_details &&
    typeof o.completion_tokens_details === "object" &&
    !Array.isArray(o.completion_tokens_details)
      ? (o.completion_tokens_details as Record<string, unknown>)
      : undefined;

  const cacheReadRaw =
    details?.cached_tokens ??
    o.prompt_cache_hit_tokens ??
    o.cache_read_input_tokens ??
    o.cacheReadTokens;
  const cacheWriteRaw =
    o.cache_creation_input_tokens ??
    o.cacheWriteTokens ??
    details?.cache_write_tokens;
  const reasoningRaw =
    completionDetails?.reasoning_tokens ??
    o.reasoning_tokens ??
    o.reasoningTokens;

  const cacheRead =
    typeof cacheReadRaw === "number" &&
    Number.isFinite(cacheReadRaw) &&
    cacheReadRaw >= 0
      ? Math.trunc(cacheReadRaw)
      : undefined;
  const cacheWrite =
    typeof cacheWriteRaw === "number" &&
    Number.isFinite(cacheWriteRaw) &&
    cacheWriteRaw >= 0
      ? Math.trunc(cacheWriteRaw)
      : undefined;
  const reasoning =
    typeof reasoningRaw === "number" &&
    Number.isFinite(reasoningRaw) &&
    reasoningRaw >= 0
      ? Math.trunc(reasoningRaw)
      : undefined;

  const promptTotal = Math.trunc(input);
  const outputTokens = Math.trunc(output);
  const uncached =
    cacheRead !== undefined ? Math.max(0, promptTotal - cacheRead) : promptTotal;
  const combined = promptTotal + outputTokens;
  const wireTotal = o.total_tokens ?? o.totalTokens;
  const hasExactTotal =
    Number.isSafeInteger(combined)
    && combined >= 0
    && (wireTotal === undefined
      || (typeof wireTotal === "number"
        && Number.isSafeInteger(wireTotal)
        && wireTotal === combined));

  return {
    inputTokens: uncached,
    outputTokens,
    ...(hasExactTotal ? { totalTokens: combined } : {}),
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
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
