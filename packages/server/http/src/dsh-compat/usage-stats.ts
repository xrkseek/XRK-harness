/**
 * @ychris12138/dsh-usage-stats — usage panel backed by tokenledger aggregate when wired.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import type { TokenLedgerOptions } from "./tokenledger.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

function emptyUsage(): Record<string, unknown> {
  return {
    windows: {
      today: { tokens: 0, inputTokens: 0, outputTokens: 0 },
      week: { tokens: 0, inputTokens: 0, outputTokens: 0 },
      month: { tokens: 0, inputTokens: 0, outputTokens: 0 },
    },
    activity: [],
    activityModels: [],
    sites: [],
    models: [],
  };
}

export async function handleUsageStatsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TokenLedgerOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api/usage-stats")) return false;

  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (pathname === "/api/usage-stats/usage") {
    const days = url.searchParams.has("days")
      ? Number(url.searchParams.get("days"))
      : undefined;
    const site = url.searchParams.get("site") ?? undefined;
    const aggregated = options.aggregateUsage
      ? await options.aggregateUsage({
          ...(days !== undefined && !Number.isNaN(days) ? { days } : {}),
          ...(site ? { site } : {}),
        })
      : undefined;
    const body = aggregated ?? emptyUsage();
    sendJson(res, 200, { ok: true, ...body, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/usage-stats/providers") {
    const providers = options.listUsageProviders
      ? await options.listUsageProviders()
      : [];
    sendJson(res, 200, {
      ok: true,
      providers,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/usage-stats/account") {
    const provider = url.searchParams.get("provider") ?? "default";
    const fetchBalance = options.fetchBalance;
    const balance = fetchBalance ? await fetchBalance(provider) : undefined;
    sendJson(res, 200, {
      ok: true,
      account: balance ?? {
        provider,
        balance: null,
        currency: "USD",
        fetched: false,
        fetchedAt: Date.now(),
        adapter: DSH_COMPAT_ADAPTER,
      },
    });
    return true;
  }

  sendJson(res, 200, { ok: true, path: pathname, adapter: DSH_COMPAT_ADAPTER });
  return true;
}

export function isUsageStatsPath(pathname: string): boolean {
  return pathname.startsWith("/api/usage-stats");
}
