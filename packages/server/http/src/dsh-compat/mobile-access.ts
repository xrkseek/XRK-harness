/**
 * dsh-mobile — file-backed mobile access control + pairing keys.
 * Opens same-origin access (no Cordis tunnel); Android app pairing uses generated appKey.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { sendJson } from "../http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, isMutatingMethod, parseJsonBody } from "./underlying/http-kit.js";

export interface MobileAccessOptions {
  readonly xrkHome?: string;
}

interface MobileState {
  running: boolean;
  appKey: string;
  csrf: string;
  customCss: string;
  customJs: string;
  origin: string;
}

const DEFAULT_STATE: MobileState = {
  running: false,
  appKey: "",
  csrf: "",
  customCss: "",
  customJs: "",
  origin: "",
};

const MOBILE_STORE = createXrkDocStore(
  ["mobile-access", "state.json"],
  { ...DEFAULT_STATE },
);

function loadState(options: MobileAccessOptions): MobileState {
  return { ...DEFAULT_STATE, ...MOBILE_STORE.read(options.xrkHome).data };
}

function saveState(
  options: MobileAccessOptions,
  state: MobileState,
): number {
  return MOBILE_STORE.write(options.xrkHome, state).revision;
}

/** Pocket / IM 只读 mobile-access 运行态（revision 信封下的 data）。 */
export function readMobileAccessSnapshot(
  options: MobileAccessOptions,
): Pick<MobileState, "running" | "origin" | "appKey"> {
  const state = loadState(options);
  return {
    running: state.running,
    origin: state.origin,
    appKey: state.appKey,
  };
}

function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host?.trim();
  if (!host) return "";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    "http";
  return `${proto}://${host}`;
}

function setCsrfCookie(res: ServerResponse, csrf: string): void {
  res.setHeader(
    "set-cookie",
    `dsh_ma_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Strict; HttpOnly`,
  );
}

export async function handleMobileAccessHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MobileAccessOptions,
): Promise<boolean> {
  if (pathname === "/api/mobile-access/settings") {
    const method = httpMethod(req);
    const state = loadState(options);
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ok: true,
        customCss: state.customCss,
        customJs: state.customJs,
        running: state.running,
        origin: state.origin,
      });
      return true;
    }
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const next = { ...state };
      if (typeof body.customCss === "string") next.customCss = body.customCss;
      if (typeof body.customJs === "string") next.customJs = body.customJs;
      saveState(options, next);
      sendJson(res, 200, {
        ok: true,
        customCss: next.customCss,
        customJs: next.customJs,
      });
      return true;
    }
  }

  if (pathname === "/api/mobile-access/control") {
    const method = httpMethod(req);
    const state = loadState(options);
    if (method === "GET" || method === "HEAD") {
      const origin = state.origin || requestOrigin(req);
      sendJson(res, 200, {
        running: state.running,
        ...(state.running && origin ? { origin } : {}),
      });
      return true;
    }
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const next = { ...state };
      if (typeof body.running === "boolean") {
        next.running = body.running;
      } else {
        next.running = !state.running;
      }
      if (!next.csrf) next.csrf = mintToken();
      if (next.running) {
        next.origin = requestOrigin(req);
      } else {
        next.origin = "";
      }
      saveState(options, next);
      setCsrfCookie(res, next.csrf);
      sendJson(res, 200, {
        running: next.running,
        ...(next.running && next.origin ? { origin: next.origin } : {}),
      });
      return true;
    }
  }

  if (pathname === "/api/mobile-access/pairing/open") {
    const method = httpMethod(req);
    if (isMutatingMethod(method)) await parseJsonBody(req);
    const state = loadState(options);
    if (!state.running) {
      sendJson(res, 200, { ok: false, error: "mobile access is not running" });
      return true;
    }
    const next = { ...state, appKey: mintToken() };
    if (!next.csrf) next.csrf = mintToken();
    saveState(options, next);
    setCsrfCookie(res, next.csrf);
    sendJson(res, 200, { ok: true, appKey: next.appKey });
    return true;
  }

  if (pathname === "/mobile-access/custom.css") {
    const state = loadState(options);
    const body = state.customCss || "/* dsh-mobile custom css */\n";
    res.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-cache",
      "content-length": String(Buffer.byteLength(body)),
    });
    res.end(body);
    return true;
  }

  if (pathname === "/mobile-access/custom.js") {
    const state = loadState(options);
    const body = state.customJs || "/* dsh-mobile custom js */\n";
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "content-length": String(Buffer.byteLength(body)),
    });
    res.end(body);
    return true;
  }

  return false;
}

export function isMobileAccessPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/mobile-access/") ||
    pathname.startsWith("/mobile-access/")
  );
}
