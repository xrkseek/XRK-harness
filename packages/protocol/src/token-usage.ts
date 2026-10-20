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

function asUsageDetails(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Soft-parse provider usage blobs; returns undefined when unusable.
 *
 * Accepts OpenAI chat (`prompt_tokens`), Responses (`input_tokens` +
 * `input_tokens_details`), Anthropic (`cache_*_input_tokens`), and Gemini
 * (`promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`).
 *
 * Wire prompt totals often **include** cache hits. Harness {@link TokenUsage}
 * keeps **disjoint** buckets, so cache reads are subtracted from `inputTokens`.
 */
export function tryParseOpenAiUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const input =
    o.prompt_tokens ??
    o.input_tokens ??
    o.inputTokens ??
    o.promptTokenCount;
  const output =
    o.completion_tokens ??
    o.output_tokens ??
    o.outputTokens ??
    o.candidatesTokenCount;
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

  const details = asUsageDetails(o.prompt_tokens_details);
  const inputDetails = asUsageDetails(o.input_tokens_details);
  const completionDetails = asUsageDetails(
    o.completion_tokens_details ?? o.output_tokens_details,
  );

  const cacheReadRaw =
    details?.cached_tokens ??
    inputDetails?.cached_tokens ??
    o.prompt_cache_hit_tokens ??
    o.cache_read_input_tokens ??
    o.cachedContentTokenCount ??
    o.cacheReadTokens;
  const cacheWriteRaw =
    o.cache_creation_input_tokens ??
    o.cacheWriteTokens ??
    details?.cache_write_tokens ??
    inputDetails?.cache_write_tokens;
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
  const wireTotal = o.total_tokens ?? o.totalTokens ?? o.totalTokenCount;
  // Prefer the provider total when present (Codex `tokens_in_context_window`);
  // else reconstitute prompt+output.
  const totalTokens =
    typeof wireTotal === "number" &&
    Number.isSafeInteger(wireTotal) &&
    wireTotal >= 0
      ? wireTotal
      : Number.isSafeInteger(combined) && combined >= 0
        ? combined
        : undefined;

  return {
    inputTokens: uncached,
    outputTokens,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
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

/**
 * Prompt-side occupancy (disjoint Harness buckets). Never includes output or
 * `cacheWriteTokens` (Anthropic cache_creation is already inside wire input).
 */
export function promptPressureTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0);
}

/**
 * Context-window occupancy from one provider sample (Codex
 * `tokens_in_context_window`): prefer exact {@link TokenUsage.totalTokens};
 * else {@link promptPressureTokens}.
 */
export function inputPressureTokens(usage: TokenUsage): number {
  if (usage.totalTokens !== undefined) {
    return usage.totalTokens;
  }
  return promptPressureTokens(usage);
}
