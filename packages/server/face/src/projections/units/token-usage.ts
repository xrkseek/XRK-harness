import {
  providerUsageSample,
  type SessionEvent,
  type TokenUsage,
} from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";
import { asNonNegInt } from "../parse-int.js";

/** Durable cumulative provider usage (DSH tokenUsage; StatsLine token group). */
export interface TokenUsageProjection {
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

interface UsageSample {
  readonly turnId: string;
  readonly stepId: string;
  readonly buckets: TokenUsageProjection;
}

interface TokenUsageState {
  readonly totals: TokenUsageProjection;
  readonly last: UsageSample | null;
}

const ZERO: TokenUsageProjection = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function bucketsFrom(usage: TokenUsage): TokenUsageProjection {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  };
}

function bucketsEqual(
  left: TokenUsageProjection,
  right: TokenUsageProjection,
): boolean {
  return (
    left.uncachedInputTokens === right.uncachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens
  );
}

function addReplacing(
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection {
  return {
    uncachedInputTokens:
      totals.uncachedInputTokens -
      (previous?.uncachedInputTokens ?? 0) +
      next.uncachedInputTokens,
    outputTokens:
      totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens:
      totals.cacheReadTokens -
      (previous?.cacheReadTokens ?? 0) +
      next.cacheReadTokens,
    cacheWriteTokens:
      totals.cacheWriteTokens -
      (previous?.cacheWriteTokens ?? 0) +
      next.cacheWriteTokens,
  };
}

/**
 * DSH tokenUsage fold over XRK flat events.
 * Mid-stream `assistant/chunk` kind=usage + final `assistant/message.usage`
 * replace the same turn/step sample (no double count).
 */
export function createTokenUsageProjectionUnit(): ProjectionDefinition<
  "tokenUsage",
  TokenUsageState,
  TokenUsageProjection
> {
  return {
    key: "tokenUsage",
    stateVersion: 1,
    init: () => ({ totals: ZERO, last: null }),
    apply(state, event: SessionEvent): TokenUsageState {
      const sample = providerUsageSample(event);
      if (!sample) return state;
      const { usage, turnId, stepId } = sample;
      const buckets = bucketsFrom(usage);
      const previous =
        state.last !== null &&
        state.last.turnId === turnId &&
        state.last.stepId === stepId
          ? state.last.buckets
          : undefined;
      if (previous !== undefined && bucketsEqual(previous, buckets)) {
        return state;
      }
      return {
        totals: addReplacing(state.totals, previous, buckets),
        last: { turnId, stepId, buckets },
      };
    },
    wire: {
      view: (state) => state.totals,
      parse(value: unknown): TokenUsageProjection {
        if (!value || typeof value !== "object") {
          throw new Error("tokenUsage projection must be an object");
        }
        const v = value as Record<string, unknown>;
        return {
          uncachedInputTokens: asNonNegInt(
            v.uncachedInputTokens,
            "tokenUsage",
            "uncachedInputTokens",
          ),
          outputTokens: asNonNegInt(v.outputTokens, "tokenUsage", "outputTokens"),
          cacheReadTokens: asNonNegInt(
            v.cacheReadTokens,
            "tokenUsage",
            "cacheReadTokens",
          ),
          cacheWriteTokens: asNonNegInt(
            v.cacheWriteTokens,
            "tokenUsage",
            "cacheWriteTokens",
          ),
        };
      },
    },
  };
}
