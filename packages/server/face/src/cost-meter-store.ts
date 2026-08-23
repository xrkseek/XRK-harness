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
import { bundledCostMeterPriceConfig } from "./cost-meter-pricing.js";
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

function balanceFromCache(
  ledger: LedgerFile,
): Record<string, unknown> {
  const cached = ledger.balanceCache;
  if (cached) {
    return {
      status: cached.status,
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
      status: cached.status,
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
      status: cached.status,
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

export function loadLedger(): LedgerFile {
  const file = ledgerFile();
  try {
    if (!existsSync(file)) {
      return { config: defaultCostMeterConfig(), history: [] };
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as LedgerFile;
    return {
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

/** DSH tokenledger / usage-stats aggregate from persisted ledger history. */
export function costMeterAggregateUsage(query?: {
  readonly days?: number;
}): Record<string, unknown> {
  const ledger = loadLedger();
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

  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let reasoning = 0;
  let cost = 0;
  const activity: Array<{ day: string; tokens: number; cost?: number }> = [];
  const modelMap = new Map<string, { tokens: number; cost: number }>();

  for (const day of slice) {
    const tokens =
      day.input + day.output + day.cacheRead + day.cacheWrite + day.reasoning;
    input += day.input;
    output += day.output;
    cacheRead += day.cacheRead;
    cacheWrite += day.cacheWrite;
    reasoning += day.reasoning;
    cost += day.cost;
    activity.push({ day: day.date, tokens, cost: day.cost });
    for (const [model, buckets] of Object.entries(day.byModel)) {
      const rowTokens =
        buckets.input +
        buckets.output +
        buckets.cacheRead +
        buckets.cacheWrite +
        buckets.reasoning;
      const prev = modelMap.get(model) ?? { tokens: 0, cost: 0 };
      modelMap.set(model, {
        tokens: prev.tokens + rowTokens,
        cost: prev.cost + buckets.cost,
      });
    }
  }

  const tokens = input + output + cacheRead + cacheWrite + reasoning;
  const bucket = { tokens, inputTokens: input, outputTokens: output, cost };
  const models = [...modelMap.entries()].map(([model, row]) => ({
    model,
    tokens: row.tokens,
    cost: row.cost,
  }));

  return {
    ok: true,
    windows: { today: bucket, week: bucket, month: bucket },
    activity,
    activityModels: models,
    sites: [],
    models,
    cost,
    adapter: "xrk-dsh-compat",
  };
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

/** dsh-wallet `usage` panel: recent daily cost from ledger (CNY display). */
export function costMeterDisplayExchangeRate(): number {
  const ledger = loadLedger();
  return typeof ledger.config.exchangeRate === "number"
    ? ledger.config.exchangeRate
    : 7.2;
}

/** dsh-wallet `usage` panel: recent daily cost from ledger (CNY display). */
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
    degraded: mapped.every((d) => d.cost === 0),
  };
}
