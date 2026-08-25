/**
 * dsh-cost-meter ledger — file-backed state for Face `costMeter/*` remotes.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { bundledCostMeterPriceConfig, estimateBucketsCostUsd } from "./cost-meter-pricing.js";
import {
  emptyDeepSeekBalance,
  queryDeepSeekBalance,
  type DeepSeekBalanceSnapshot,
} from "./cost-meter-balance.js";
import {
  emptyGoQuotaSnapshot,
  goQuotaApiKeyFromLedgerConfig,
  queryGoQuota,
  type GoQuotaSnapshot,
} from "./cost-meter-go-quota.js";
import {
  mergedCodingPlansState,
  refreshCodingPlanProvider,
  type CodingPlanSnapshot,
} from "./cost-meter-coding-plan-service.js";
import {
  emptyCustomBalanceSnapshot,
  queryCustomBalance,
  type CustomBalanceSnapshot,
} from "./cost-meter-custom-balance.js";

export interface CostMeterBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
}

export interface CostMeterDay {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  calls: number;
  cost: number;
  byModel: Record<string, CostMeterBuckets>;
  byProviderModel: Record<string, CostMeterBuckets>;
  sessions: Array<Record<string, unknown>>;
}

export interface CostMeterState {
  today: CostMeterDay;
  month: CostMeterDay;
  total: CostMeterDay;
  budgetUsed?: number;
  balance: Record<string, unknown>;
  goQuota: Record<string, unknown>;
  customBalance: Record<string, unknown>;
  codingPlans: Record<string, unknown>;
  history: CostMeterDay[];
  config: Record<string, unknown>;
  priceCatalog: Record<string, unknown> | null;
  meta: {
    now: number;
    timezoneOffsetMinutes: number;
    dayKey: string;
    monthKey: string;
  };
}

export type LedgerFile = {
  config: Record<string, unknown>;
  history: CostMeterDay[];
  pendingByKey?: Record<string, CostMeterUsageSample>;
  balanceCache?: DeepSeekBalanceSnapshot;
  goQuotaCache?: GoQuotaSnapshot;
  customBalanceCache?: CustomBalanceSnapshot;
  codingPlansCache?: Record<string, CodingPlanSnapshot>;
};

export interface CostMeterRefreshResult {
  readonly ok: boolean;
  readonly message: string;
  readonly state: CostMeterState;
}

export interface CostMeterUsageSample {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepId: string;
  readonly ts: number;
  readonly provider: string;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  /** USD estimate at record time (from bundled / configured prices). */
  readonly cost: number;
}

let configuredHome: string | undefined;

/** Align ledger path with Face `productDir` (~/.xrk). */
export function configureCostMeterHome(home?: string): void {
  configuredHome = home?.trim() || undefined;
}

function xrkHomeDir(): string {
  return (
    configuredHome ??
    (process.env.XRK_HOME?.trim() || path.join(homedir(), ".xrk"))
  );
}

function ledgerFile(): string {
  return path.join(
    xrkHomeDir(),
    "storages",
    "cost-meter",
    "ledger.json",
  );
}

function dayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function emptyDay(date: string): CostMeterDay {
  return {
    date,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    calls: 0,
    cost: 0,
    byModel: {},
    byProviderModel: {},
    sessions: [],
  };
}

export function defaultCostMeterConfig(): Record<string, unknown> {
  return {
    locale: "auto",
    position: "dock",
    sidebar: true,
    showSessionId: false,
    hideOfficialBalance: false,
    hideTodayCost: false,
    pricingCurrency: "USD",
    currency: "CNY",
    symbol: "¥",
    decimals: 4,
    exchangeRate: 7.2,
    peakEnabled: false,
    peakEffectiveAt: "",
    peakWindows: [],
    peakNotice: true,
    peakAlertEnabled: true,
    peakAlertAhead: 2,
    peakAlertTarget: "both",
    peakAlertPosition: "corner",
    peakAlertWebNotify: false,
    peakStyle: "compact",
    priceMatch: "auto",
    priceOverrides: {},
    priceTableDisplay: {},
    codingPlans: {},
    prices: bundledCostMeterPriceConfig(),
    historyDays: 180,
    fetchedAt: null,
    priceSource: "bundled",
    budget: {
      enabled: false,
      amount: 100,
      period: "month",
      customStart: null,
      customEnd: null,
      detail: true,
    },
    balance: {
      display: "both",
      refreshMinutes: 5,
      showProgressBar: false,
      budgetCap: null,
      clickHintSeen: false,
    },
    goQuota: {
      enabled: true,
      display: "both",
      refreshMinutes: 15,
      apiKey: "",
      main: "rolling",
      detail: true,
    },
    customBalance: {
      enabled: false,
      display: "off",
      refreshMinutes: 15,
      label: "",
      unit: "USD",
      request: { url: "", method: "GET", headers: {} },
      extract: {},
    },
    corner: {
      enabled: false,
      goRolling: true,
      goWeekly: true,
      goMonthly: true,
      budget: true,
    },
    quotaStrip: {
      enabled: false,
      budget: true,
      go: true,
      plans: true,
      promptSeen: false,
    },
    usage: { position: "cost" },
  };
}

/** dsh-cost-meter expects `error`; internal snapshots use `err`. */
function dshBalanceStatus(
  status: DeepSeekBalanceSnapshot["status"],
): "ok" | "error" | "off" {
  if (status === "ok") return "ok";
  if (status === "err") return "error";
  return "off";
}

function balanceFromCache(
  ledger: LedgerFile,
): Record<string, unknown> {
  const cached = ledger.balanceCache;
  if (cached) {
    return {
      status: dshBalanceStatus(cached.status),
      message: cached.message,
      fetchedAt: cached.fetchedAt,
      currency: cached.currency,
      totalBalance: cached.totalBalance,
      grantedBalance: cached.grantedBalance,
      toppedUpBalance: cached.toppedUpBalance,
    };
  }
  return { ...emptyDeepSeekBalance() };
}

function goQuotaFromCache(ledger: LedgerFile): Record<string, unknown> {
  const cached = ledger.goQuotaCache;
  if (cached) {
    return {
      status: cached.status === "err" ? "error" : cached.status,
      message: cached.message,
      fetchedAt: cached.fetchedAt,
      rolling: cached.rolling,
      weekly: cached.weekly,
      monthly: cached.monthly,
    };
  }
  return { ...emptyGoQuotaSnapshot() };
}

function customBalanceFromCache(ledger: LedgerFile): Record<string, unknown> {
  const cached = ledger.customBalanceCache;
  if (cached) {
    return {
      status: cached.status === "err" ? "error" : cached.status,
      message: cached.message,
      fetchedAt: cached.fetchedAt,
      label: cached.label,
      unit: cached.unit,
      remaining: cached.remaining,
      maxBudget: cached.maxBudget,
      spend: cached.spend,
    };
  }
  return { ...emptyCustomBalanceSnapshot() };
}

function looksLikeLegacyV3UsdTable(prices: unknown): boolean {
  if (!prices || typeof prices !== "object") return false;
  const p = prices as Record<string, unknown>;
  const def = (p.default ?? (p.models as Record<string, unknown> | undefined)?.["deepseek-chat"]) as
    | Record<string, unknown>
    | undefined;
  if (!def) return false;
  return def.cacheHit === 0.07 && def.cacheMiss === 0.27 && def.output === 1.1;
}

/**
 * Upgrade V3-era bundled tables to V4 flash/pro and recompute every stored cost
 * from disjoint token buckets (dsh-cost-meter costOf). Returns true when ledger mutated.
 */
export function migrateAndRepriceLedger(ledger: LedgerFile): boolean {
  let changed = false;
  if (looksLikeLegacyV3UsdTable(ledger.config.prices)) {
    ledger.config = {
      ...ledger.config,
      prices: bundledCostMeterPriceConfig(),
      priceSource: "bundled-v4",
    };
    changed = true;
  } else {
    const prices = (ledger.config.prices as Record<string, unknown>) ?? {};
    const models = {
      ...(bundledCostMeterPriceConfig().models as Record<string, unknown>),
      ...((prices.models as Record<string, unknown>) ?? {}),
    };
    const before = JSON.stringify(prices.models ?? {});
    const nextPrices = {
      ...bundledCostMeterPriceConfig(),
      ...prices,
      models,
      default: prices.default ?? bundledCostMeterPriceConfig().default,
    };
    if (JSON.stringify(nextPrices.models) !== before) {
      ledger.config = { ...ledger.config, prices: nextPrices };
      changed = true;
    }
  }

  for (const day of ledger.history) {
    let dayCost = 0;
    for (const session of day.sessions) {
      const provider = String(session.provider ?? "deepseek");
      const model = String(session.model ?? "unknown");
      const buckets = {
        input: Number(session.input ?? 0),
        output: Number(session.output ?? 0),
        cacheRead: Number(session.cacheRead ?? 0),
        cacheWrite: Number(session.cacheWrite ?? 0),
        reasoning: Number(session.reasoning ?? 0),
      };
      const lastAt = Number(session.lastAt ?? 0);
      const cost = estimateBucketsCostUsd(
        buckets,
        provider,
        model,
        ledger.config,
        lastAt > 0 ? lastAt : undefined,
      );
      if (Math.abs(Number(session.cost ?? 0) - cost) > 1e-12) {
        session.cost = cost;
        changed = true;
      }
      dayCost += cost;

      const byPm = session.byProviderModel as
        | Record<string, CostMeterBuckets>
        | undefined;
      if (byPm) {
        for (const [key, row] of Object.entries(byPm)) {
          const [prov, ...rest] = key.split(":");
          const mdl = rest.join(":") || model;
          const next = estimateBucketsCostUsd(
            row,
            prov || provider,
            mdl,
            ledger.config,
            lastAt > 0 ? lastAt : undefined,
          );
          if (Math.abs(row.cost - next) > 1e-12) {
            row.cost = next;
            changed = true;
          }
        }
      }
      const byModel = session.byModel as Record<string, CostMeterBuckets> | undefined;
      if (byModel) {
        for (const [mdl, row] of Object.entries(byModel)) {
          const next = estimateBucketsCostUsd(
            row,
            provider,
            mdl,
            ledger.config,
            lastAt > 0 ? lastAt : undefined,
          );
          if (Math.abs(row.cost - next) > 1e-12) {
            row.cost = next;
            changed = true;
          }
        }
      }
    }
    if (Math.abs(day.cost - dayCost) > 1e-12) {
      day.cost = dayCost;
      changed = true;
    }
  }

  if (ledger.pendingByKey) {
    for (const [key, sample] of Object.entries(ledger.pendingByKey)) {
      const next = estimateBucketsCostUsd(
        sample,
        sample.provider,
        sample.model,
        ledger.config,
        sample.ts,
      );
      if (Math.abs(sample.cost - next) > 1e-12) {
        ledger.pendingByKey[key] = { ...sample, cost: next };
        changed = true;
      }
    }
  }
  return changed;
}

export function loadLedger(): LedgerFile {
  const file = ledgerFile();
  try {
    if (!existsSync(file)) {
      return { config: defaultCostMeterConfig(), history: [] };
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as LedgerFile;
    const ledger: LedgerFile = {
      config: {
        ...defaultCostMeterConfig(),
        ...(raw.config && typeof raw.config === "object" ? raw.config : {}),
      },
      history: Array.isArray(raw.history) ? raw.history : [],
      ...(raw.pendingByKey && typeof raw.pendingByKey === "object"
        ? { pendingByKey: raw.pendingByKey }
        : {}),
      ...(raw.balanceCache && typeof raw.balanceCache === "object"
        ? { balanceCache: raw.balanceCache }
        : {}),
      ...(raw.goQuotaCache && typeof raw.goQuotaCache === "object"
        ? { goQuotaCache: raw.goQuotaCache }
        : {}),
      ...(raw.customBalanceCache && typeof raw.customBalanceCache === "object"
        ? {
            customBalanceCache: raw.customBalanceCache,
          }
        : {}),
      ...(raw.codingPlansCache && typeof raw.codingPlansCache === "object"
        ? {
            codingPlansCache: raw.codingPlansCache,
          }
        : {}),
    };
    if (migrateAndRepriceLedger(ledger)) {
      try {
        saveLedger(ledger);
      } catch {
        // Read path must not fail closed if the file is momentarily locked.
      }
    }
    return ledger;
  } catch {
    return { config: defaultCostMeterConfig(), history: [] };
  }
}

export function saveLedger(ledger: LedgerFile): void {
  const file = ledgerFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function aggregateDays(days: CostMeterDay[]): CostMeterDay {
  const out = emptyDay("");
  for (const day of days) {
    out.input += day.input;
    out.output += day.output;
    out.cacheRead += day.cacheRead;
    out.cacheWrite += day.cacheWrite;
    out.reasoning += day.reasoning;
    out.calls += day.calls;
    out.cost += day.cost;
  }
  return out;
}

export function buildCostMeterState(ledger: LedgerFile): CostMeterState {
  const now = new Date();
  const dk = dayKey(now);
  const mk = monthKey(now);
  const today =
    ledger.history.find((d) => d.date === dk) ?? emptyDay(dk);
  const monthDays = ledger.history.filter((d) => d.date.startsWith(mk));
  const month = aggregateDays(monthDays.length ? monthDays : [emptyDay(mk)]);
  month.date = mk;
  const total = aggregateDays(ledger.history);
  total.date = "total";
  return {
    today,
    month,
    total,
    balance: balanceFromCache(ledger),
    goQuota: goQuotaFromCache(ledger),
    customBalance: customBalanceFromCache(ledger),
    codingPlans: mergedCodingPlansState(
      ledger.config,
      ledger.codingPlansCache,
    ),
    history: ledger.history,
    config: ledger.config,
    priceCatalog: null,
    meta: {
      now: now.getTime(),
      timezoneOffsetMinutes: now.getTimezoneOffset(),
      dayKey: dk,
      monthKey: mk,
    },
  };
}

export function costMeterGetState(): CostMeterState {
  return buildCostMeterState(loadLedger());
}

export function costMeterUpdateConfig(
  patch: Record<string, unknown>,
): CostMeterState {
  const ledger = loadLedger();
  ledger.config = {
    ...ledger.config,
    ...patch,
    prices:
      patch.prices && typeof patch.prices === "object"
        ? {
            ...(ledger.config.prices as Record<string, unknown>),
            ...(patch.prices as Record<string, unknown>),
          }
        : ledger.config.prices,
    budget:
      patch.budget && typeof patch.budget === "object"
        ? {
            ...((ledger.config.budget) ?? {}),
            ...(patch.budget as Record<string, unknown>),
          }
        : ledger.config.budget,
  };
  saveLedger(ledger);
  return buildCostMeterState(ledger);
}

export function costMeterResetHistory(): CostMeterState {
  const ledger = loadLedger();
  ledger.history = [];
  ledger.pendingByKey = {};
  saveLedger(ledger);
  return buildCostMeterState(ledger);
}

export function costMeterFetchPrices(): {
  prices: Record<string, unknown>;
  state: CostMeterState;
} {
  const ledger = loadLedger();
  const state = buildCostMeterState(ledger);
  const prices = (ledger.config.prices ?? {}) as Record<string, unknown>;
  return { prices, state };
}

export function costMeterImportLegacyHistory(): {
  ok: boolean;
  message: string;
  state: CostMeterState;
} {
  return {
    ok: false,
    message: "use costMeter/importLegacyHistory Face remote with session store",
    state: buildCostMeterState(loadLedger()),
  };
}

export function costMeterGetDaySessions(date: string): {
  date: string;
  sessions: Array<Record<string, unknown>>;
} {
  const ledger = loadLedger();
  const day = ledger.history.find((d) => d.date === date);
  return { date, sessions: day?.sessions ?? [] };
}

export function costMeterGetTopSessions(
  limit = 20,
  sort = "cost",
  dir: "asc" | "desc" = "desc",
): { sessions: Array<Record<string, unknown>> } {
  const ledger = loadLedger();
  const all: Array<Record<string, unknown>> = [];
  for (const day of ledger.history) {
    for (const session of day.sessions) all.push(session);
  }
  const key = sort === "time" ? "lastAt" : "cost";
  all.sort((a, b) => {
    const av = Number(a[key] ?? 0);
    const bv = Number(b[key] ?? 0);
    return dir === "asc" ? av - bv : bv - av;
  });
  return { sessions: all.slice(0, Math.max(1, limit)) };
}

export function costMeterRefreshSidecar(): CostMeterState {
  return buildCostMeterState(loadLedger());
}

export async function costMeterRefreshBalance(): Promise<CostMeterRefreshResult> {
  const ledger = loadLedger();
  const balanceCfg =
    ledger.config.balance &&
    typeof ledger.config.balance === "object" &&
    !Array.isArray(ledger.config.balance)
      ? (ledger.config.balance as Record<string, unknown>)
      : {};
  if (balanceCfg.display === "off") {
    return {
      ok: false,
      message: "balance display is off",
      state: buildCostMeterState(ledger),
    };
  }
  const value = await queryDeepSeekBalance(xrkHomeDir());
  ledger.balanceCache = value;
  saveLedger(ledger);
  return {
    ok: value.status === "ok",
    message:
      value.status === "ok"
        ? "balance refreshed"
        : value.message || "balance query failed",
    state: buildCostMeterState(ledger),
  };
}

export async function costMeterRefreshGoQuota(): Promise<CostMeterRefreshResult> {
  const ledger = loadLedger();
  const goCfg =
    ledger.config.goQuota &&
    typeof ledger.config.goQuota === "object" &&
    !Array.isArray(ledger.config.goQuota)
      ? (ledger.config.goQuota as Record<string, unknown>)
      : {};
  if (goCfg.enabled === false) {
    return {
      ok: false,
      message: "go quota disabled",
      state: buildCostMeterState(ledger),
    };
  }
  if (goCfg.display === "off") {
    return {
      ok: false,
      message: "go quota display is off",
      state: buildCostMeterState(ledger),
    };
  }
  const apiKey = goQuotaApiKeyFromLedgerConfig(ledger.config);
  const value = await queryGoQuota(
    xrkHomeDir(),
    ...(apiKey ? [{ apiKey }] : []),
  );
  ledger.goQuotaCache = value;
  saveLedger(ledger);
  return {
    ok: value.status === "ok",
    message:
      value.status === "ok"
        ? "go quota refreshed"
        : value.message || "go quota query failed",
    state: buildCostMeterState(ledger),
  };
}

export async function costMeterRefreshCustomBalance(): Promise<CostMeterRefreshResult> {
  const ledger = loadLedger();
  const customCfg =
    ledger.config.customBalance &&
    typeof ledger.config.customBalance === "object" &&
    !Array.isArray(ledger.config.customBalance)
      ? (ledger.config.customBalance as Record<string, unknown>)
      : {};
  if (customCfg.enabled !== true) {
    return {
      ok: false,
      message: "custom balance disabled",
      state: buildCostMeterState(ledger),
    };
  }
  if (customCfg.display === "off") {
    return {
      ok: false,
      message: "custom balance display is off",
      state: buildCostMeterState(ledger),
    };
  }
  const value = await queryCustomBalance(xrkHomeDir(), ledger.config);
  ledger.customBalanceCache = value;
  saveLedger(ledger);
  return {
    ok: value.status === "ok",
    message:
      value.status === "ok"
        ? "custom balance refreshed"
        : value.message || "custom balance query failed",
    state: buildCostMeterState(ledger),
  };
}

export async function costMeterRefreshCodingPlan(
  provider: string,
): Promise<CostMeterRefreshResult> {
  const ledger = loadLedger();
  const id = provider.trim();
  if (!id) {
    return {
      ok: false,
      message: "provider required",
      state: buildCostMeterState(ledger),
    };
  }
  const value = await refreshCodingPlanProvider(
    xrkHomeDir(),
    ledger.config,
    ledger.history,
    id,
  );
  ledger.codingPlansCache = {
    ...(ledger.codingPlansCache ?? {}),
    [id]: value,
  };
  saveLedger(ledger);
  return {
    ok: value.status === "ok",
    message:
      value.status === "ok"
        ? "coding plan refreshed"
        : value.message || "coding plan query failed",
    state: buildCostMeterState(ledger),
  };
}

function dayTokens(day: CostMeterDay): number {
  return day.input + day.output + day.cacheRead + day.cacheWrite + day.reasoning;
}

function foldDays(days: readonly CostMeterDay[]): {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly cost: number;
  readonly calls: number;
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let reasoning = 0;
  let cost = 0;
  let calls = 0;
  for (const day of days) {
    input += day.input;
    output += day.output;
    cacheRead += day.cacheRead;
    cacheWrite += day.cacheWrite;
    reasoning += day.reasoning;
    cost += day.cost;
    calls += day.calls;
  }
  return { input, output, cacheRead, cacheWrite, reasoning, cost, calls };
}

function usageBucketFromFold(
  fold: ReturnType<typeof foldDays>,
): { tokens: number; inputTokens: number; outputTokens: number; cost: number } {
  const tokens =
    fold.input + fold.output + fold.cacheRead + fold.cacheWrite + fold.reasoning;
  return {
    tokens,
    inputTokens: fold.input,
    outputTokens: fold.output,
    cost: fold.cost,
  };
}

function siteIdForProvider(provider: string): string {
  return provider === "deepseek" || provider === "deepseek-official"
    ? "direct"
    : provider;
}

/** DSH tokenledger / usage-stats aggregate from persisted ledger history. */
export function costMeterAggregateUsage(query?: {
  readonly days?: number;
}): Record<string, unknown> {
  const ledger = loadLedger();
  const exchangeRate =
    typeof ledger.config.exchangeRate === "number"
      ? ledger.config.exchangeRate
      : 7.2;
  const currency =
    typeof ledger.config.currency === "string" && ledger.config.currency.trim()
      ? ledger.config.currency
      : "CNY";
  const days =
    typeof query?.days === "number" && Number.isFinite(query.days)
      ? Math.max(1, Math.floor(query.days))
      : undefined;
  const history = [...ledger.history].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const slice =
    days !== undefined && history.length > days
      ? history.slice(-days)
      : history;

  const todayKey = dayKey();
  const monthPrefix = monthKey();
  const todayFold = foldDays(history.filter((d) => d.date === todayKey));
  const monthFold = foldDays(history.filter((d) => d.date.startsWith(monthPrefix)));
  const allFold = foldDays(history);
  const rangeFold = foldDays(slice);

  const activity: Array<{ day: string; tokens: number; cost?: number }> = [];
  const modelMap = new Map<
    string,
    {
      tokens: number;
      cost: number;
      inputTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
      requests: number;
    }
  >();
  const siteMap = new Map<string, number>();
  let lastActivityAt = 0;

  for (const day of slice) {
    const tokens = dayTokens(day);
    activity.push({ day: day.date, tokens, cost: day.cost });
    for (const [model, buckets] of Object.entries(day.byModel)) {
      const rowTokens =
        buckets.input +
        buckets.output +
        buckets.cacheRead +
        buckets.cacheWrite +
        buckets.reasoning;
      const prev = modelMap.get(model) ?? {
        tokens: 0,
        cost: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        requests: 0,
      };
      modelMap.set(model, {
        tokens: prev.tokens + rowTokens,
        cost: prev.cost + buckets.cost,
        inputTokens: prev.inputTokens + buckets.input + buckets.cacheWrite,
        cacheReadTokens: prev.cacheReadTokens + buckets.cacheRead,
        outputTokens: prev.outputTokens + buckets.output,
        requests: prev.requests + day.calls,
      });
    }
    for (const [providerModel, buckets] of Object.entries(day.byProviderModel)) {
      const provider = providerModel.split(":")[0] ?? providerModel;
      const site = siteIdForProvider(provider);
      const rowTokens =
        buckets.input +
        buckets.output +
        buckets.cacheRead +
        buckets.cacheWrite +
        buckets.reasoning;
      siteMap.set(site, (siteMap.get(site) ?? 0) + rowTokens);
    }
    for (const session of day.sessions) {
      const lastAt = Number(session.lastAt ?? 0);
      if (lastAt > lastActivityAt) lastActivityAt = lastAt;
    }
  }

  const tokens = rangeFold.input + rangeFold.output + rangeFold.cacheRead
    + rangeFold.cacheWrite + rangeFold.reasoning;
  // DSH: cacheRead / (cacheRead + uncached input); not / all tokens.
  const cacheDenom = rangeFold.cacheRead + rangeFold.input;
  const cacheHitRate =
    cacheDenom > 0
      ? Math.round((rangeFold.cacheRead / cacheDenom) * 1000) / 10
      : 0;
  const models = [...modelMap.entries()].map(([model, row]) => ({
    model,
    tokens: row.tokens,
    cost: row.cost,
    inputTokens: row.inputTokens,
    cacheReadTokens: row.cacheReadTokens,
    outputTokens: row.outputTokens,
    requests: row.requests,
  }));
  const pricedRows = models.map((row) => ({
    model: row.model,
    cost: row.cost * exchangeRate,
    currency,
  }));
  const pricedTotal = rangeFold.cost * exchangeRate;
  const sites = [...siteMap.entries()]
    .map(([site, siteTokens]) => ({ site, tokens: siteTokens }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    ok: true,
    totals: {
      tokens,
      requests: rangeFold.calls,
      cacheHitRate,
      inputTokens: rangeFold.input + rangeFold.cacheWrite,
      outputTokens: rangeFold.output,
    },
    windows: {
      today: usageBucketFromFold(todayFold),
      week: usageBucketFromFold(rangeFold),
      month: usageBucketFromFold(monthFold),
      all: usageBucketFromFold(allFold),
    },
    activity,
    activityModels: models,
    sites,
    directory: sites.map((row) => ({
      id: row.site,
      routes: row.site === "direct" ? ["api.deepseek.com"] : [row.site],
    })),
    models,
    priced: {
      totals: pricedTotal > 0 ? { [currency]: pricedTotal } : {},
      rows: pricedRows,
    },
    accounts: [{ id: "default", displayName: "DeepSeek Official" }],
    lastSweepAt: Date.now(),
    diagnostics: {
      ...(lastActivityAt > 0 ? { lastUpdatedAt: lastActivityAt } : {}),
      unattributedRows: 0,
    },
    timeZone: {
      offset: formatTimezoneOffset(new Date().getTimezoneOffset()),
      name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    cost: rangeFold.cost,
    adapter: "xrk-dsh-compat",
  };
}

function formatTimezoneOffset(offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export interface CostMeterSessionTotals {
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

/** Sum ledger session rows for a Face session id (live cost-meter data). */
export function costMeterSessionTotals(
  sessionId: string,
): CostMeterSessionTotals | null {
  const id = sessionId.trim();
  if (!id) return null;
  const ledger = loadLedger();
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let costUsd = 0;
  let found = false;
  for (const day of ledger.history) {
    for (const row of day.sessions) {
      if (row.id !== id) continue;
      found = true;
      input += Number(row.input ?? 0);
      output += Number(row.output ?? 0);
      cacheRead += Number(row.cacheRead ?? 0);
      cacheWrite += Number(row.cacheWrite ?? 0);
      costUsd += Number(row.cost ?? 0);
    }
  }
  if (!found) return null;
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd,
  };
}

/** dsh-wallet usage panel: recent daily cost from ledger (CNY display). */
export function costMeterDisplayExchangeRate(): number {
  const ledger = loadLedger();
  return typeof ledger.config.exchangeRate === "number"
    ? ledger.config.exchangeRate
    : 7.2;
}

/** Recent daily cost for dsh-wallet (CNY). */
export function costMeterWalletUsage(days = 7): {
  readonly today: { date: string; cost: number };
  readonly days: Array<{ date: string; cost: number }>;
  readonly ready: boolean;
  readonly degraded: boolean;
} {
  const ledger = loadLedger();
  const rate =
    typeof ledger.config.exchangeRate === "number"
      ? ledger.config.exchangeRate
      : 7.2;
  const history = [...ledger.history].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const slice = history.slice(-Math.max(1, days));
  const mapped = slice.map((day) => ({
    date: day.date,
    cost: day.cost * rate,
  }));
  const todayKey = dayKey();
  const todayRow = mapped.find((d) => d.date === todayKey);
  return {
    today: todayRow ?? { date: todayKey, cost: 0 },
    days: mapped,
    ready: mapped.length > 0,
    degraded: false,
  };
}
