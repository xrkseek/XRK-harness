/**
 * `dsh-univer-office` — `/univer-api/*` offline gateway the client parses.
 * No Univer process is started; status/state stay stopped with stable codes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface UniverApiOptions {
  readonly xrkHome?: string;
}

interface UniverDoc {
  lastStartAttemptAt: string | null;
  startAttempts: number;
}

const STORE = createXrkDocStore<UniverDoc>(["dsh-univer-office", "state.json"], {
  lastStartAttemptAt: null,
  startAttempts: 0,
});

function stoppedGateway(): Record<string, unknown> {
  return {
    phase: "stopped",
    gateway: null,
    owned: false,
    pid: null,
    port: null,
    baseUrl: null,
  };
}

export function isUniverApiPath(pathname: string): boolean {
  return pathname === "/univer-api" || pathname.startsWith("/univer-api/");
}

export async function handleUniverApiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: UniverApiOptions = {},
): Promise<boolean> {
  if (!isUniverApiPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (pathname === "/univer-api/status" || pathname === "/univer-api") {
    const meta = STORE.read(xrkHome).data;
    sendJson(res, 200, {
      gateway: stoppedGateway(),
      unitContent: "bundled",
      startAttempts: meta.startAttempts,
      lastStartAttemptAt: meta.lastStartAttemptAt,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/univer-api/gateway/start") {
    await parseJsonBody(req).catch(() => ({}));
    const doc = STORE.patch(xrkHome, (current) => ({
      startAttempts: current.startAttempts + 1,
      lastStartAttemptAt: new Date().toISOString(),
    }));
    sendJson(res, 200, {
      ok: false,
      reason: "compat-offline",
      message:
        "Univer Gateway is not embedded on XRK-Harness; office files stay offline.",
      gateway: stoppedGateway(),
      startAttempts: doc.data.startAttempts,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/univer-api/gateway/stop") {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: true,
      gateway: stoppedGateway(),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/univer-api/state") {
    const file = url.searchParams.get("file") ?? "";
    const sessionId = url.searchParams.get("sessionId") ?? "";
    sendJson(res, 200, {
      ok: false,
      error: "GATEWAY_UNAVAILABLE",
      reason: "Univer Gateway is not available.",
      code: "GATEWAY_UNAVAILABLE",
      file,
      sessionId,
      gateway: stoppedGateway(),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/univer-api/worktree-action") {
    const body = await parseJsonBody(req);
    sendJson(res, 200, {
      ok: false,
      reason: "compat-offline",
      action: typeof body.action === "string" ? body.action : null,
      message: "Worktree actions require a live Univer Gateway.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    pathname === "/univer-api/open" ||
    pathname === "/univer-api/save" ||
    pathname === "/univer-api/export" ||
    pathname.startsWith("/univer-api/")
  ) {
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      await parseJsonBody(req).catch(() => ({}));
    }
    sendJson(res, 200, {
      ok: false,
      error: "GATEWAY_UNAVAILABLE",
      reason: "compat-offline",
      path: pathname,
      gateway: stoppedGateway(),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
