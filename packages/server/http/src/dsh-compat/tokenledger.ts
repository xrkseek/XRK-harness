/**
 * dsh-tokenledger — aggregate Face tokenUsage into DSH-shaped usage API.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";

export interface TokenLedgerUsageQuery {
  readonly days?: number;
  readonly site?: string;
}

export interface TokenLedgerOptions {
  readonly xrkHome?: string;
  readonly aggregateUsage?: (
    query: TokenLedgerUsageQuery,
  ) => Promise<Record<string, unknown> | undefined>;
  readonly fetchBalance?: (
    account?: string,
  ) => Promise<Record<string, unknown> | undefined>;
  readonly listUsageProviders?: () => Promise<
    readonly UsageStatsProviderRow[]
  >;
}

export interface UsageStatsProviderRow {
  readonly id: string;
  readonly displayName?: string;
  readonly configured?: boolean;
  readonly accountMode?: string;
}

interface BalanceStore {
  accounts: Record<string, { balance: number; currency: string; updatedAt: string }>;
}

const BALANCE_STORE = createXrkDocStore<BalanceStore>(
  ["tokenledger", "balance.json"],
  { accounts: {} },
);

function loadBalanceStore(xrkHome?: string): BalanceStore {
  const data = BALANCE_STORE.read(xrkHome).data;
  return {
    accounts:
      data.accounts && typeof data.accounts === "object" ? data.accounts : {},
  };
}

function defaultFetchBalance(xrkHome?: string) {
  return async (account?: string) => {
    const store = loadBalanceStore(xrkHome);
    const key = account?.trim() || "default";
    const row = store.accounts[key];
    return {
      ok: true,
      supported: true,
      fetched: Boolean(row),
      account: key,
      balance: row?.balance ?? null,
      currency: row?.currency ?? "USD",
      adapter: DSH_COMPAT_ADAPTER,
    };
  };
}

/**
 * Aggregate Face `tokenUsage` projections into tokenledger usage shape.
 */
export function createTokenLedgerBridgeFromFace(face: {
  readonly store: { list(): readonly string[] };
  readonly projections: {
    snapshot(sessionId: string): { values: { tokenUsage?: {
      uncachedInputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    } } };
  };
}): Pick<TokenLedgerOptions, "aggregateUsage" | "fetchBalance"> {
  return {
    async aggregateUsage() {
      let input = 0;
      let output = 0;
      let cacheRead = 0;
      let cacheWrite = 0;
      for (const sessionId of face.store.list()) {
        const tu = face.projections.snapshot(sessionId).values.tokenUsage;
        if (!tu) continue;
        input += tu.uncachedInputTokens ?? 0;
        output += tu.outputTokens ?? 0;
        cacheRead += tu.cacheReadTokens ?? 0;
        cacheWrite += tu.cacheWriteTokens ?? 0;
      }
      const tokens = input + output + cacheRead + cacheWrite;
      const day = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })();
      const bucket = { tokens, inputTokens: input, outputTokens: output };
      const requests = face.store.list().length;
      return {
        ok: true,
        totals: {
          tokens,
          requests,
          cacheHitRate: cacheRead + cacheWrite > 0 ? cacheRead / tokens : 0,
          inputTokens: input,
          outputTokens: output,
        },
        windows: { today: bucket, week: bucket, month: bucket },
        activity: [{ day, tokens }],
        activityModels: [],
        sites: [],
        models: [],
        priced: { totals: {} },
        adapter: DSH_COMPAT_ADAPTER,
      };
    },
    async fetchBalance(account?: string) {
      const fromFace = await defaultFetchBalance(undefined)(account);
      return fromFace;
    },
  };
}

function emptyUsage(): Record<string, unknown> {
  const bucket = { tokens: 0, inputTokens: 0, outputTokens: 0 };
  return {
    ok: true,
    totals: {
      tokens: 0,
      requests: 0,
      cacheHitRate: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    windows: {
      today: bucket,
      week: bucket,
      month: bucket,
    },
    activity: [],
    activityModels: [],
    sites: [],
    models: [],
    priced: { totals: {} },
  };
}

export async function handleTokenLedgerHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TokenLedgerOptions,
): Promise<boolean> {
  const normalized = pathname.startsWith("/tokenledger")
    ? `/api${pathname}`
    : pathname;
  if (!normalized.startsWith("/api/tokenledger")) return false;

  const url = new URL(
    normalized +
      (req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
    "http://127.0.0.1",
  );
  const days = url.searchParams.has("days")
    ? Number(url.searchParams.get("days"))
    : undefined;
  const site = url.searchParams.get("site") ?? undefined;

  if (normalized === "/api/tokenledger/usage") {
    const aggregated = options.aggregateUsage
      ? await options.aggregateUsage({
          ...(days !== undefined && !Number.isNaN(days) ? { days } : {}),
          ...(site !== undefined && site !== "" ? { site } : {}),
        })
      : undefined;
    sendJson(res, 200, aggregated ?? emptyUsage());
    return true;
  }

  if (normalized === "/api/tokenledger/balance") {
    const account = url.searchParams.get("account") ?? undefined;
    const fetchBalance =
      options.fetchBalance ?? defaultFetchBalance(options.xrkHome);
    const balance = await fetchBalance(account);
    sendJson(res, 200, balance ?? {
      ok: true,
      supported: true,
      fetched: false,
      balance: null,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 200, { path: pathname, adapter: DSH_COMPAT_ADAPTER });
  return true;
}
