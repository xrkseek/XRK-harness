/**
 * dsh-wallet HTTP adapter — 只解析路径/方法，业务走 {@link XrkWalletPort}。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";
import { parseJsonBody } from "./underlying/http-kit.js";
import {
  createXrkWalletPort,
  type XrkWalletServiceOptions,
} from "./underlying/wallet-service.js";
import type { XrkWalletPort } from "./underlying/contracts/wallet-port.js";

export interface WalletOptions extends XrkWalletServiceOptions {
  /** Host 注入的底层端口；缺省时用 xrkHome + face 现场组装 */
  readonly walletPort?: XrkWalletPort;
}

function resolvePort(options: WalletOptions): XrkWalletPort {
  return options.walletPort ?? createXrkWalletPort(options);
}

function normalizeWalletPath(pathname: string): string {
  if (pathname.startsWith("/wallet/api/")) {
    return `/api/wallet/${pathname.slice("/wallet/api/".length)}`;
  }
  return pathname;
}

export async function handleWalletHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: WalletOptions,
): Promise<boolean> {
  const normalized = normalizeWalletPath(pathname);
  if (!normalized.startsWith("/api/wallet")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const port = resolvePort(options);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (normalized === "/api/wallet/balance" && method === "GET") {
    sendJson(res, 200, await port.getBalanceView());
    return true;
  }

  if (normalized === "/api/wallet/refresh" && method === "GET") {
    sendJson(res, 200, await port.getBalanceView());
    return true;
  }

  if (normalized === "/api/wallet/cost" && method === "GET") {
    const session = url.searchParams.get("session") ?? undefined;
    sendJson(res, 200, await port.getCostView(session));
    return true;
  }

  if (normalized === "/api/wallet/usage" && method === "GET") {
    sendJson(res, 200, await port.getUsageView());
    return true;
  }

  if (normalized === "/api/wallet/set-threshold" && method === "POST") {
    const body = await parseJsonBody(req);
    const threshold =
      typeof body.threshold === "number" && Number.isFinite(body.threshold)
        ? body.threshold
        : 5;
    const costThreshold = await port.setCostThreshold(threshold);
    sendJson(res, 200, { ok: true, costThreshold });
    return true;
  }

  if (normalized === "/api/wallet/snapshot" && method === "GET") {
    sendJson(res, 200, await port.getSnapshot());
    return true;
  }

  if (normalized === "/api/wallet/threshold") {
    if (method === "GET") {
      const snap = await port.getSnapshot();
      sendJson(res, 200, {
        ok: true,
        threshold: (snap as { threshold?: number | null }).threshold ?? null,
      });
      return true;
    }
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const threshold =
        typeof body.threshold === "number" ? body.threshold : null;
      if (threshold !== null) await port.setCostThreshold(threshold);
      sendJson(res, 200, { ok: true, threshold });
      return true;
    }
  }

  if (normalized === "/api/wallet/accounts") {
    if (method === "GET") {
      sendJson(res, 200, { ok: true, accounts: await port.listAccounts() });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const account = await port.addAccount({
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
        balance: typeof body.balance === "number" ? body.balance : null,
        ...(typeof body.currency === "string" ? { currency: body.currency } : {}),
      });
      sendJson(res, 201, { ok: true, account });
      return true;
    }
  }

  const accountMatch = /^\/api\/wallet\/accounts\/([^/]+)$/.exec(normalized);
  if (accountMatch) {
    const id = decodeURIComponent(accountMatch[1]!);
    if (method === "DELETE") {
      await port.removeAccount(id);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "PUT" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const account = await port.updateAccount(id, body);
      sendJson(res, 200, { ok: true, account });
      return true;
    }
  }

  if (method === "GET") {
    sendJson(res, 200, await port.getSnapshot());
    return true;
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
  return true;
}

export function isWalletPath(pathname: string): boolean {
  return pathname.startsWith("/api/wallet") || pathname.startsWith("/wallet/api");
}

export type { XrkWalletPort, WalletFaceBridge } from "./underlying/contracts/wallet-port.js";
export { createXrkWalletPort, mapSessionCostToDsh } from "./underlying/wallet-service.js";
