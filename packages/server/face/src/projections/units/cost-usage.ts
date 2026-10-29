/**
 * DSH `costUsage` projection — per-session token buckets for dsh-cost-meter.
 */
import { providerUsageSample, type SessionEvent } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";
import {
  bundledCostMeterPriceConfig,
  estimateUsageCostUsd,
} from "../../cost-meter-pricing.js";

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
): string {
  if (route) return `${route.provider}:${route.model}`;
  return "unknown:unknown";
}

const PRICE_CONFIG = bundledCostMeterPriceConfig();

function bucketsFromUsage(
  usage: NonNullable<ReturnType<typeof providerUsageSample>>["usage"],
  route: { provider: string; model: string } | null,
): CostUsageBuckets {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const reasoning = usage.reasoningTokens ?? 0;
  const cost =
    route !== null
      ? estimateUsageCostUsd(
          {
            provider: route.provider,
            model: route.model,
            input,
            output,
            cacheRead,
            cacheWrite,
            reasoning,
          },
          PRICE_CONFIG,
        )
      : 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    cost,
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

function parseBuckets(value: unknown, label: string): CostUsageBuckets {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const v = value as Record<string, unknown>;
  const num = (k: string): number => {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`${label}.${k} must be a finite number`);
    }
    return n;
  };
  return {
    input: num("input"),
    output: num("output"),
    cacheRead: num("cacheRead"),
    cacheWrite: num("cacheWrite"),
    reasoning: num("reasoning"),
    cost: num("cost"),
  };
}

function parseBucketMap(
  value: unknown,
  label: string,
): Record<string, CostUsageBuckets> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const out: Record<string, CostUsageBuckets> = {};
  for (const [key, buckets] of Object.entries(value as Record<string, unknown>)) {
    out[key] = parseBuckets(buckets, `${label}.${key}`);
  }
  return out;
}

function parseCostUsageProjection(value: unknown): CostUsageProjection {
  const totals = parseBuckets(value, "costUsage.state.totals");
  if (!value || typeof value !== "object") {
    throw new Error("costUsage.state.totals must be an object");
  }
  const v = value as Record<string, unknown>;
  return {
    ...totals,
    byModel: parseBucketMap(v.byModel ?? {}, "costUsage.state.totals.byModel"),
    byProviderModel: parseBucketMap(
      v.byProviderModel ?? {},
      "costUsage.state.totals.byProviderModel",
    ),
  };
}

function parseRoute(
  value: unknown,
): { provider: string; model: string } | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("costUsage.state.route must be object | null");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== "string" || typeof v.model !== "string") {
    throw new Error("costUsage.state.route needs string provider/model");
  }
  return { provider: v.provider, model: v.model };
}

function parseLast(value: unknown): CostUsageState["last"] {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("costUsage.state.last must be object | null");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.turnId !== "string" || typeof v.stepId !== "string") {
    throw new Error("costUsage.state.last needs string turnId/stepId");
  }
  if (typeof v.modelKey !== "string") {
    throw new Error("costUsage.state.last.modelKey must be a string");
  }
  return {
    turnId: v.turnId,
    stepId: v.stepId,
    modelKey: v.modelKey,
    buckets: parseBuckets(v.buckets, "costUsage.state.last.buckets"),
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
    parseState(value: unknown): CostUsageState {
      if (!value || typeof value !== "object") {
        throw new Error("costUsage state must be an object");
      }
      const v = value as Record<string, unknown>;
      const totals = parseCostUsageProjection(v.totals);
      const route = parseRoute(v.route);
      const last = parseLast(v.last);
      return { totals, route, last };
    },
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
      const modelKey = modelKeyFromRoute(state.route);
      const buckets = bucketsFromUsage(sample.usage, state.route);
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
