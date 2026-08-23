/**
 * Local bundled pricing for dsh-cost-meter (USD per 1M tokens).
 * Vendor APIs are not embedded on XRK; users may override via config.
 */
import type { CostMeterUsageSample } from "./cost-meter-store.js";

export interface ModelPriceRow {
  readonly cacheHit: number;
  readonly cacheMiss: number;
  readonly output: number;
}

const UNKNOWN_PRICE: ModelPriceRow = {
  cacheHit: 0.07,
  cacheMiss: 0.27,
  output: 1.1,
};

/** DeepSeek + common aliases (per-million USD). */
export const BUNDLED_MODEL_PRICES: Readonly<Record<string, ModelPriceRow>> =
  Object.freeze({
    "deepseek-chat": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    "deepseek-reasoner": { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
    "deepseek-v3": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    "deepseek-v3.1": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    unknown: UNKNOWN_PRICE,
  });

export const BUNDLED_PROVIDER_MODEL_PRICES: Readonly<
  Record<string, Readonly<Record<string, ModelPriceRow>>>
> = Object.freeze({
  deepseek: BUNDLED_MODEL_PRICES,
});

export function bundledCostMeterPriceConfig(): Record<string, unknown> {
  return {
    models: { ...BUNDLED_MODEL_PRICES },
    default: BUNDLED_MODEL_PRICES.unknown,
    providers: {
      deepseek: { models: { ...BUNDLED_MODEL_PRICES } },
    },
  };
}

function asPriceRow(value: unknown): ModelPriceRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const num = (k: string) =>
    typeof row[k] === "number" && Number.isFinite(row[k])
      ? (row[k])
      : undefined;
  const cacheHit = num("cacheHit");
  const cacheMiss = num("cacheMiss");
  const output = num("output");
  if (cacheHit === undefined || cacheMiss === undefined || output === undefined) {
    return undefined;
  }
  return { cacheHit, cacheMiss, output };
}

function normalizeModelKey(model: string): string {
  const trimmed = model.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown") return "unknown";
  return trimmed;
}

function rowFromConfig(
  provider: string,
  model: string,
  config: Record<string, unknown>,
): ModelPriceRow {
  const overrides = config.priceOverrides as Record<string, unknown> | undefined;
  const overrideKey = `${provider}:${model}`;
  const fromOverride =
    overrides?.[overrideKey] ?? overrides?.[model] ?? overrides?.[provider];
  const overrideRow = asPriceRow(fromOverride);
  if (overrideRow) return overrideRow;

  const prices = config.prices as Record<string, unknown> | undefined;
  const models = prices?.models as Record<string, unknown> | undefined;
  const modelRow = asPriceRow(models?.[normalizeModelKey(model)]);
  if (modelRow) return modelRow;

  const providers = prices?.providers as Record<string, unknown> | undefined;
  const providerRow = providers?.[provider] as Record<string, unknown> | undefined;
  const providerModels = providerRow?.models as
    | Record<string, unknown>
    | undefined;
  const nestedRow = asPriceRow(providerModels?.[normalizeModelKey(model)]);
  if (nestedRow) return nestedRow;

  const bundledProvider = BUNDLED_PROVIDER_MODEL_PRICES[provider];
  const bundled =
    bundledProvider?.[normalizeModelKey(model)] ??
    bundledProvider?.unknown ??
    BUNDLED_MODEL_PRICES[normalizeModelKey(model)] ??
    UNKNOWN_PRICE;
  const defaultRow = asPriceRow(prices?.default);
  return defaultRow ?? bundled ?? UNKNOWN_PRICE;
}

export function estimateUsageCostUsd(
  sample: Pick<
    CostMeterUsageSample,
    | "provider"
    | "model"
    | "input"
    | "output"
    | "cacheRead"
    | "cacheWrite"
    | "reasoning"
  >,
  config: Record<string, unknown>,
): number {
  const row = rowFromConfig(sample.provider, sample.model, config);
  const million = 1_000_000;
  const uncachedInput = Math.max(0, sample.input - sample.cacheRead);
  const reasoningOut = sample.reasoning;
  return (
    (sample.cacheRead * row.cacheHit +
      uncachedInput * row.cacheMiss +
      sample.output * row.output +
      reasoningOut * row.output) /
    million
  );
}
