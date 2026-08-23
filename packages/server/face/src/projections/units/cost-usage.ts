/**
 * DSH `costUsage` projection — per-session token buckets for dsh-cost-meter.
 */
import { providerUsageSample, type SessionEvent } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

export interface CostUsageBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
}

export interface CostUsageProjection {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  byModel: Record<string, CostUsageBuckets>;
  byProviderModel: Record<string, CostUsageBuckets>;
}

interface CostUsageState {
  totals: CostUsageProjection;
  last: {
    turnId: string;
    stepId: string;
    modelKey: string;
    buckets: CostUsageBuckets;
  } | null;
  route: { provider: string; model: string } | null;
}

const ZERO_BUCKETS: CostUsageBuckets = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0,
};

const ZERO: CostUsageProjection = {
  ...ZERO_BUCKETS,
  byModel: {},
  byProviderModel: {},
};

function modelKeyFromRoute(
  route: { provider: string; model: string } | null,
  event: SessionEvent,
): string {
  if (route) return `${route.provider}:${route.model}`;
  if (event.type === "assistant/chunk" || event.type === "assistant/message") {
    const model =
      "model" in event && typeof event.model === "string"
        ? event.model
        : "unknown";
    return `deepseek:${model}`;
  }
  return "deepseek:unknown";
}

function bucketsFromUsage(
  usage: NonNullable<ReturnType<typeof providerUsageSample>>["usage"],
): CostUsageBuckets {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
    cost: 0,
  };
}

function addBuckets(a: CostUsageBuckets, b: CostUsageBuckets): CostUsageBuckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
    cost: a.cost + b.cost,
  };
}

function mergeMap(
  map: Record<string, CostUsageBuckets>,
  key: string,
  delta: CostUsageBuckets,
  previous?: CostUsageBuckets,
): Record<string, CostUsageBuckets> {
  const current = map[key] ?? ZERO_BUCKETS;
  const withoutPrev = previous ? addBuckets(current, negate(previous)) : current;
  return { ...map, [key]: addBuckets(withoutPrev, delta) };
}

function negate(b: CostUsageBuckets): CostUsageBuckets {
  return {
    input: -b.input,
    output: -b.output,
    cacheRead: -b.cacheRead,
    cacheWrite: -b.cacheWrite,
    reasoning: -b.reasoning,
    cost: -b.cost,
  };
}

function projectionTotals(
  byProviderModel: Record<string, CostUsageBuckets>,
): CostUsageProjection {
  let totals = { ...ZERO_BUCKETS };
  for (const buckets of Object.values(byProviderModel)) {
    totals = addBuckets(totals, buckets);
  }
  const byModel: Record<string, CostUsageBuckets> = {};
  for (const [key, buckets] of Object.entries(byProviderModel)) {
    const model = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
    byModel[model] = addBuckets(byModel[model] ?? ZERO_BUCKETS, buckets);
  }
  return {
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    reasoning: totals.reasoning,
    cost: totals.cost,
    byModel,
    byProviderModel,
  };
}

export function createCostUsageProjectionUnit(): ProjectionDefinition<
  "costUsage",
  CostUsageState,
  CostUsageProjection
> {
  return {
    key: "costUsage",
    stateVersion: 1,
    init: () => ({ totals: ZERO, last: null, route: null }),
    apply(state, event: SessionEvent): CostUsageState {
      if (event.type === "request/header") {
        return {
          ...state,
          route: {
            provider: event.header.config.provider,
            model: event.header.config.model,
          },
        };
      }
      const sample = providerUsageSample(event);
      if (!sample) return state;
      const modelKey = modelKeyFromRoute(state.route, event);
      const buckets = bucketsFromUsage(sample.usage);
      const previous =
        state.last !== null &&
        state.last.turnId === sample.turnId &&
        state.last.stepId === sample.stepId &&
        state.last.modelKey === modelKey
          ? state.last.buckets
          : undefined;

      let byProviderModel = { ...state.totals.byProviderModel };
      byProviderModel = mergeMap(
        byProviderModel,
        modelKey,
        buckets,
        previous,
      );
      const totals = projectionTotals(byProviderModel);
      return {
        totals,
        route: state.route,
        last: {
          turnId: sample.turnId,
          stepId: sample.stepId,
          modelKey,
          buckets,
        },
      };
    },
    wire: {
      view: (state) => state.totals,
      parse(value: unknown): CostUsageProjection {
        if (!value || typeof value !== "object") {
          throw new Error("costUsage projection must be an object");
        }
        const v = value as Record<string, unknown>;
        const num = (k: string) =>
          typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k]) : 0;
        return {
          input: num("input"),
          output: num("output"),
          cacheRead: num("cacheRead"),
          cacheWrite: num("cacheWrite"),
          reasoning: num("reasoning"),
          cost: num("cost"),
          byModel:
            v.byModel && typeof v.byModel === "object"
              ? (v.byModel as Record<string, CostUsageBuckets>)
              : {},
          byProviderModel:
            v.byProviderModel && typeof v.byProviderModel === "object"
              ? (v.byProviderModel as Record<string, CostUsageBuckets>)
              : {},
        };
      },
    },
  };
}
