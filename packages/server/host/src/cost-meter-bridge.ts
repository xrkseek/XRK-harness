/**
 * Face → cost-meter ledger aggregate for dsh-tokenledger / usage-stats.
 */
import {
  costMeterAggregateUsage,
  costMeterGetState,
  costMeterRefreshBalance,
  type FaceRuntime,
} from "@xrkseek/server-face";
import { createTokenLedgerBridgeFromFace } from "@xrkseek/server-http";

function ledgerHasUsage(body: Record<string, unknown>): boolean {
  const totals = body.totals;
  if (
    totals &&
    typeof totals === "object" &&
    typeof (totals as { tokens?: unknown }).tokens === "number" &&
    (totals as { tokens: number }).tokens > 0
  ) {
    return true;
  }
  const activity = body.activity;
  if (!Array.isArray(activity)) return false;
  return activity.some(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { tokens?: unknown }).tokens === "number" &&
      (row as { tokens: number }).tokens > 0,
  );
}

function balanceFailureReason(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "balance query failed";
  if (/api key missing/i.test(trimmed)) return "no-credential";
  return trimmed;
}

/**
 * Map cost-meter balance cache → dsh-tokenledger `/api/tokenledger/balance`.
 */
export async function fetchTokenLedgerBalanceFromCostMeter(): Promise<
  Record<string, unknown>
> {
  const cached = costMeterGetState().balance as {
    status?: string;
    message?: string;
    fetchedAt?: number;
    currency?: string;
    totalBalance?: number;
    grantedBalance?: number;
    toppedUpBalance?: number;
  };
  const needsRefresh = cached.status === "off" && (cached.fetchedAt ?? 0) === 0;
  const refreshed = needsRefresh ? await costMeterRefreshBalance() : undefined;
  const balance = refreshed?.state.balance ?? cached;
  const status = balance.status;
  const message =
    typeof balance.message === "string" ? balance.message : "";

  if (status === "ok") {
    return {
      ok: true,
      supported: true,
      fetched: true,
      scheme: "deepseek",
      displayName: "DeepSeek",
      keyName: "DEEPSEEK_API_KEY",
      total: balance.totalBalance ?? 0,
      currency: balance.currency || "CNY",
      granted: balance.grantedBalance ?? 0,
      isAvailable: true,
      fetchedAt: balance.fetchedAt ?? Date.now(),
      adapter: "xrk-dsh-compat",
    };
  }

  return {
    ok: true,
    supported: true,
    fetched: false,
    reason: balanceFailureReason(message),
    scheme: "deepseek",
    displayName: "DeepSeek",
    keyName: "DEEPSEEK_API_KEY",
    adapter: "xrk-dsh-compat",
  };
}

function enrichTokenLedgerUsage(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const windows =
    body.windows && typeof body.windows === "object" && !Array.isArray(body.windows)
      ? (body.windows as Record<string, unknown>)
      : {};
  const bucket =
    windows.all ??
    windows.month ??
    windows.today ??
    { tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  const tokens = typeof (bucket as { tokens?: unknown }).tokens === "number"
    ? (bucket as { tokens: number }).tokens
    : 0;
  const inputTokens = typeof (bucket as { inputTokens?: unknown }).inputTokens === "number"
    ? (bucket as { inputTokens: number }).inputTokens
    : 0;
  const outputTokens = typeof (bucket as { outputTokens?: unknown }).outputTokens === "number"
    ? (bucket as { outputTokens: number }).outputTokens
    : 0;
  const totals = body.totals && typeof body.totals === "object"
    ? (body.totals as Record<string, unknown>)
    : {};
  let cacheHitRate = totals.cacheHitRate;
  if (typeof cacheHitRate === "number" && cacheHitRate > 0 && cacheHitRate <= 1) {
    cacheHitRate = Math.round(cacheHitRate * 1000) / 10;
  }
  return {
    ...body,
    windows: { ...windows, all: windows.all ?? bucket },
    totals: {
      tokens,
      requests: typeof totals.requests === "number" ? totals.requests : 0,
      cacheHitRate: typeof cacheHitRate === "number" ? cacheHitRate : 0,
      inputTokens,
      outputTokens,
      ...totals,
    },
    sites: Array.isArray(body.sites) ? body.sites : [],
    accounts: Array.isArray(body.accounts)
      ? body.accounts
      : [{ id: "default", displayName: "DeepSeek Official" }],
    priced: body.priced ?? { totals: {}, rows: [] },
    lastSweepAt: typeof body.lastSweepAt === "number" ? body.lastSweepAt : Date.now(),
    diagnostics: body.diagnostics ?? { unattributedRows: 0 },
  };
}

export function createCostMeterUsageBridge(face: FaceRuntime): {
  readonly aggregateUsage: (
    query: { readonly days?: number; readonly site?: string },
  ) => Promise<Record<string, unknown>>;
  readonly fetchBalance: (
    account?: string,
  ) => Promise<Record<string, unknown>>;
} {
  const fallback = createTokenLedgerBridgeFromFace(face);
  return {
    aggregateUsage: async (query) => {
      const fromLedger = costMeterAggregateUsage(query);
      if (ledgerHasUsage(fromLedger)) return enrichTokenLedgerUsage(fromLedger);
      const fromProjections = fallback.aggregateUsage
        ? await fallback.aggregateUsage(query)
        : undefined;
      return enrichTokenLedgerUsage(fromProjections ?? fromLedger);
    },
    fetchBalance: async () => fetchTokenLedgerBalanceFromCostMeter(),
  };
}
