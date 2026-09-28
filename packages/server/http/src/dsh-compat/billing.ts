/**
 * @kenz1117/dsh-ui-usage-billing — `/api/billing/*` response shapes the client parses.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import type { TokenLedgerOptions } from "./tokenledger.js";

export type BillingHttpOptions = TokenLedgerOptions;

const EMPTY_USAGE = {
  total: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    requestCount: 0,
  },
  byModel: {},
  byDay: {},
};

const EMPTY_PRICING = {
  source: "xrk-compat",
  catalog: [] as unknown[],
  aliases: {} as Record<string, string>,
  fetchedAt: 0,
};

export function isBillingPath(pathname: string): boolean {
  return pathname === "/api/billing" || pathname.startsWith("/api/billing/");
}

async function drain(req: IncomingMessage, method: string): Promise<void> {
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }
}

export async function handleBillingHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: BillingHttpOptions = {},
): Promise<boolean> {
  if (!isBillingPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  await drain(req, method);

  if (pathname === "/api/billing/usage-stats") {
    const aggregated = options.aggregateUsage
      ? await options.aggregateUsage({})
      : undefined;
    const body =
      aggregated && typeof aggregated === "object" && "total" in aggregated
        ? aggregated
        : EMPTY_USAGE;
    sendJson(res, 200, { ...body, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (
    pathname === "/api/billing/pricing" ||
    pathname === "/api/billing/pricing/refresh"
  ) {
    sendJson(res, 200, { ...EMPTY_PRICING, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/billing/balance") {
    const balance = options.fetchBalance
      ? await options.fetchBalance()
      : undefined;
    sendJson(res, 200, {
      balances: Array.isArray((balance as { balances?: unknown })?.balances)
        ? (balance as { balances: unknown[] }).balances
        : [],
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    pathname === "/api/billing/subscriptions" ||
    pathname === "/api/billing/relay-quotas"
  ) {
    sendJson(res, 200, { quotas: {}, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/billing/usage-tool") {
    sendJson(res, 200, { enabled: false, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/billing/notify-claim") {
    sendJson(res, 200, { claimed: true, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
