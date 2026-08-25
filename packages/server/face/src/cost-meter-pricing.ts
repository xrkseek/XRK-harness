/**
 * Local bundled pricing for cost-meter (USD per 1M tokens).
 * Formula + V4 rates aligned with MIT dsh-cost-meter `lib/pricing.js` / official DeepSeek.
 * TokenUsage buckets are **disjoint**: `input` = cache-miss only (not including cacheRead).
 */
import type { CostMeterUsageSample } from "./cost-meter-store.js";

export interface ModelPriceTier {
  readonly cacheHit: number;
  readonly cacheMiss: number;
  readonly output: number;
  /** Extra reasoning rate; default 0 — reasoning is usually already in output. */
  readonly reasoning?: number;
}

export interface ModelPriceRow extends ModelPriceTier {
  readonly peak?: ModelPriceTier;
  readonly offPeak?: ModelPriceTier;
  readonly legacyBase?: ModelPriceTier;
}

const FLASH_OFF: ModelPriceTier = {
  cacheHit: 0.007,
  cacheMiss: 0.22,
  output: 0.66,
};
const FLASH_PEAK: ModelPriceTier = {
  cacheHit: 0.014,
  cacheMiss: 0.44,
  output: 1.32,
};
const PRO_OFF: ModelPriceTier = {
  cacheHit: 0.022,
  cacheMiss: 0.66,
  output: 1.98,
};
const PRO_PEAK: ModelPriceTier = {
  cacheHit: 0.044,
  cacheMiss: 1.32,
  output: 3.96,
};

/** Pre-2026-08-16 DeepSeek V3-era rates (legacy only). */
const LEGACY_CHAT: ModelPriceTier = {
  cacheHit: 0.07,
  cacheMiss: 0.27,
  output: 1.1,
};

function withPeak(off: ModelPriceTier, peak: ModelPriceTier): ModelPriceRow {
  return { ...off, offPeak: off, peak, legacyBase: LEGACY_CHAT };
}

/** DeepSeek + aliases (per-million USD). Keys are lowercase product ids. */
export const BUNDLED_MODEL_PRICES: Readonly<Record<string, ModelPriceRow>> =
  Object.freeze({
    "deepseek-v4-flash": withPeak(FLASH_OFF, FLASH_PEAK),
    "deepseek-v4-flash-vision": withPeak(FLASH_OFF, FLASH_PEAK),
    "deepseek-v4-flash-vision-exp": withPeak(FLASH_OFF, FLASH_PEAK),
    "deepseek-v4-pro": withPeak(PRO_OFF, PRO_PEAK),
    // Product still emits these aliases; bill as current flash off-peak.
    "deepseek-chat": withPeak(FLASH_OFF, FLASH_PEAK),
    "deepseek-reasoner": withPeak(FLASH_OFF, FLASH_PEAK),
    "deepseek-v3": { ...LEGACY_CHAT, legacyBase: LEGACY_CHAT },
    "deepseek-v3.1": { ...LEGACY_CHAT, legacyBase: LEGACY_CHAT },
    unknown: withPeak(FLASH_OFF, FLASH_PEAK),
  });

export const BUNDLED_PROVIDER_MODEL_PRICES: Readonly<
  Record<string, Readonly<Record<string, ModelPriceRow>>>
> = Object.freeze({
  deepseek: BUNDLED_MODEL_PRICES,
});

/** Default peak windows (UTC hours), Mon–Fri — same as dsh-cost-meter. */
export const DEFAULT_PEAK_WINDOWS: readonly { startHour: number; endHour: number }[] =
  Object.freeze([
    { startHour: 1, endHour: 4 },
    { startHour: 6, endHour: 10 },
  ]);

export function bundledCostMeterPriceConfig(): Record<string, unknown> {
  return {
    models: { ...BUNDLED_MODEL_PRICES },
    default: BUNDLED_MODEL_PRICES.unknown,
    providers: {
      deepseek: { models: { ...BUNDLED_MODEL_PRICES } },
    },
  };
}

function asTier(value: unknown): ModelPriceTier | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = row[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const cacheHit = num("cacheHit");
  const cacheMiss = num("cacheMiss");
  const output = num("output");
  if (cacheHit === undefined || cacheMiss === undefined || output === undefined) {
    return undefined;
  }
  const reasoning = num("reasoning");
  return {
    cacheHit,
    cacheMiss,
    output,
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function asPriceRow(value: unknown): ModelPriceRow | undefined {
  const base = asTier(value);
  if (!base) return undefined;
  const row = value as Record<string, unknown>;
  const peak = asTier(row.peak);
  const offPeak = asTier(row.offPeak);
  const legacyBase = asTier(row.legacyBase);
  return {
    ...base,
    ...(peak ? { peak } : {}),
    ...(offPeak ? { offPeak } : {}),
    ...(legacyBase ? { legacyBase } : {}),
  };
}

/** Normalize model id for table lookup (drop spaces/punct like dsh-cost-meter). */
export function canonModelId(id: string): string {
  return String(id ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function matchModelKey(
  model: string,
  candidates: readonly string[],
): string | undefined {
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  if (candidates.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const exactLower = candidates.find((c) => c.toLowerCase() === lower);
  if (exactLower) return exactLower;
  const canon = canonModelId(trimmed);
  if (!canon) return undefined;
  const byCanon = candidates.find((c) => canonModelId(c) === canon);
  if (byCanon) return byCanon;
  // Prefer longest candidate contained in the request (vision-exp → flash-vision-exp).
  let best: string | undefined;
  let bestLen = 0;
  for (const c of candidates) {
    const cc = canonModelId(c);
    if (cc.length < 4) continue;
    if (canon.includes(cc) && cc.length > bestLen) {
      best = c;
      bestLen = cc.length;
    }
  }
  return best;
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
  const modelKeys = models ? Object.keys(models) : [];
  const matched =
    matchModelKey(model, modelKeys) ??
    matchModelKey(model, Object.keys(BUNDLED_MODEL_PRICES));
  if (matched && models?.[matched]) {
    const modelRow = asPriceRow(models[matched]);
    if (modelRow) return modelRow;
  }

  const providers = prices?.providers as Record<string, unknown> | undefined;
  const providerRow = providers?.[provider] as Record<string, unknown> | undefined;
  const providerModels = providerRow?.models as
    | Record<string, unknown>
    | undefined;
  if (providerModels) {
    const pk = matchModelKey(model, Object.keys(providerModels));
    if (pk) {
      const nestedRow = asPriceRow(providerModels[pk]);
      if (nestedRow) return nestedRow;
    }
  }

  const bundledProvider = BUNDLED_PROVIDER_MODEL_PRICES[provider];
  const bundledKey =
    matchModelKey(model, Object.keys(bundledProvider ?? BUNDLED_MODEL_PRICES)) ??
    "unknown";
  const bundled =
    bundledProvider?.[bundledKey] ??
    BUNDLED_MODEL_PRICES[bundledKey] ??
    BUNDLED_MODEL_PRICES.unknown!;
  const defaultRow = asPriceRow(prices?.default);
  return defaultRow ?? bundled;
}

function isPeakHour(
  atMs: number,
  windows: readonly { startHour: number; endHour: number }[],
): boolean {
  const d = new Date(atMs);
  // Weekend = always off-peak (dsh-cost-meter after WEEKEND_OFFPEAK).
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = d.getUTCHours();
  return windows.some((w) => hour >= w.startHour && hour < w.endHour);
}

function resolveTier(
  row: ModelPriceRow,
  config: Record<string, unknown>,
  atMs?: number,
): ModelPriceTier {
  const peakEnabled = config.peakEnabled === true;
  const windows =
    Array.isArray(config.peakWindows) && config.peakWindows.length > 0
      ? (config.peakWindows as { startHour: number; endHour: number }[])
      : DEFAULT_PEAK_WINDOWS;
  if (!peakEnabled || atMs === undefined) {
    return row.offPeak ?? row;
  }
  if (isPeakHour(atMs, windows)) {
    return row.peak ?? row;
  }
  return row.offPeak ?? row;
}

/**
 * Estimate USD cost. `sample.input` must be **uncached** (disjoint from cacheRead).
 */
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
  > & { readonly ts?: number },
  config: Record<string, unknown>,
): number {
  const row = rowFromConfig(sample.provider, sample.model, config);
  const tier = resolveTier(row, config, sample.ts);
  const million = 1_000_000;
  const input = Math.max(0, sample.input);
  const output = Math.max(0, sample.output);
  const cacheRead = Math.max(0, sample.cacheRead);
  const cacheWrite = Math.max(0, sample.cacheWrite);
  const reasoning = Math.max(0, sample.reasoning);
  const reasoningRate = tier.reasoning ?? 0;
  return (
    (input * tier.cacheMiss +
      output * tier.output +
      (cacheRead + cacheWrite) * tier.cacheHit +
      reasoning * reasoningRate) /
    million
  );
}

/** Recompute a CostMeterBuckets-shaped cost from stored token counts. */
export function estimateBucketsCostUsd(
  buckets: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly reasoning: number;
  },
  provider: string,
  model: string,
  config: Record<string, unknown>,
  ts?: number,
): number {
  return estimateUsageCostUsd(
    {
      provider,
      model,
      input: buckets.input,
      output: buckets.output,
      cacheRead: buckets.cacheRead,
      cacheWrite: buckets.cacheWrite,
      reasoning: buckets.reasoning,
      ...(ts !== undefined ? { ts } : {}),
    },
    config,
  );
}
