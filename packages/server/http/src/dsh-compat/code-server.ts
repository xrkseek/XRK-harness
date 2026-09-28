/**
 * dsh-code-server-app — `/code-server/*`, `/api/code-server/*`, `/ask/*`.
 * Process spawn stays deferred; preferred port / start attempts persist.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface CodeServerOptions {
  readonly xrkHome?: string;
}

interface CodeServerDoc {
  preferredPort: number | null;
  uiMode: string;
  startAttempts: number;
  lastStartAttemptAt: string | null;
  askRev: number;
  askMessages: unknown[];
}

const STORE = createXrkDocStore<CodeServerDoc>(
  ["dsh-code-server", "state.json"],
  {
    preferredPort: null,
    uiMode: "iframe",
    startAttempts: 0,
    lastStartAttemptAt: null,
    askRev: 0,
    askMessages: [],
  },
);

export function isCodeServerPath(pathname: string): boolean {
  return (
    pathname === "/code-server" ||
    pathname.startsWith("/code-server/") ||
    pathname === "/api/code-server" ||
    pathname.startsWith("/api/code-server/") ||
    pathname === "/ask" ||
    pathname.startsWith("/ask/")
  );
}

function offlineStatus(doc: CodeServerDoc): Record<string, unknown> {
  return {
    ok: true,
    running: false,
    status: "stopped",
    pid: null,
    port: doc.preferredPort,
    url: null,
    serve: null,
    uiMode: doc.uiMode,
    startAttempts: doc.startAttempts,
    lastStartAttemptAt: doc.lastStartAttemptAt,
    adapter: DSH_COMPAT_ADAPTER,
    note: "code-server process host is not embedded on XRK; start stays deferred.",
  };
}

function normalizePath(pathname: string): string {
  if (pathname.startsWith("/api/code-server")) {
    return (
      pathname.replace(/^\/api\/code-server/, "/code-server") || "/code-server"
    );
  }
  return pathname;
}

export async function handleCodeServerHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: CodeServerOptions = {},
): Promise<boolean> {
  if (!isCodeServerPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const pathNorm = normalizePath(pathname);

  if (
    pathNorm === "/code-server/status" ||
    pathNorm === "/code-server/status/" ||
    pathNorm === "/code-server" ||
    pathNorm === "/code-server/"
  ) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, offlineStatus(STORE.read(xrkHome).data));
    return true;
  }

  if (pathNorm === "/code-server/start") {
    await parseJsonBody(req).catch(() => ({}));
    const doc = STORE.patch(xrkHome, (current) => ({
      ...current,
      startAttempts: current.startAttempts + 1,
      lastStartAttemptAt: new Date().toISOString(),
    }));
    sendJson(res, 200, {
      ...offlineStatus(doc.data),
      accepted: false,
      deferred: true,
      path: pathname,
    });
    return true;
  }

  if (
    pathNorm === "/code-server/stop" ||
    pathNorm === "/code-server/setup" ||
    pathNorm === "/code-server/open-file"
  ) {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ...offlineStatus(STORE.read(xrkHome).data),
      accepted: false,
      deferred: true,
      path: pathname,
    });
    return true;
  }

  if (pathNorm === "/code-server/ui-mode") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ok: true,
        uiMode: STORE.read(xrkHome).data.uiMode,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const body = await parseJsonBody(req);
    const uiMode =
      typeof body.uiMode === "string"
        ? body.uiMode
        : typeof body.mode === "string"
          ? body.mode
          : "iframe";
    STORE.patch(xrkHome, (current) => ({ ...current, uiMode }));
    sendJson(res, 200, {
      ok: true,
      uiMode,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/ask/state" || pathname.startsWith("/ask/state")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rev = url.searchParams.get("rev");
    const doc = STORE.read(xrkHome).data;
    if (rev !== null && rev !== "" && Number(rev) === doc.askRev) {
      sendJson(res, 200, doc.askRev);
      return true;
    }
    sendJson(res, 200, {
      rev: doc.askRev,
      messages: doc.askMessages,
      pending: null,
      open: false,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    pathname === "/ask/send" ||
    pathname === "/ask/approve" ||
    pathname === "/ask/close" ||
    pathname === "/ask/bundle" ||
    pathNorm === "/code-server/ask/send" ||
    pathNorm === "/code-server/ask/approve" ||
    pathNorm === "/code-server/ask/close"
  ) {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: true,
      deferred: true,
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
      js: "",
      css: "",
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ...offlineStatus(STORE.read(xrkHome).data),
    path: pathname,
  });
  return true;
}
