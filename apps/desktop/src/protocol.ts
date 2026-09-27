/**
 * Custom `xrk-app://` protocol: version-matched static Web assets + navigation guard (ADR-0008).
 * Fetch to Desktop Host for `app` hostname is injectable; Node IPC stays lifecycle-only.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { maybeInjectDesktopBootHtml } from "./boot-inject.js";
import { DESKTOP_PROTOCOL_SCHEME } from "./desktop-bootstrap.js";

export { DESKTOP_PROTOCOL_SCHEME };

/** Privileges for `protocol.registerSchemesAsPrivileged` before app ready. */
export const DESKTOP_PROTOCOL_PRIVILEGES = {
  scheme: DESKTOP_PROTOCOL_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    // SSE may use a sibling hostname (`xrk-app://stream`); allow cross-host fetch.
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
} as const;

const MIME: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

export interface DesktopProtocolHandlerOptions {
  /** Assembled product Web dist (release-matched). */
  readonly webRoot: string;
  /** Optional Electron shell renderer assets (`xrk-app://shell/...`). */
  readonly shellRoot?: string;
  /**
   * When set, `xrk-app://app/...` is forwarded to the Desktop Host Fetch carrier.
   * When unset, `app` is served from {@link webRoot} (static MVP / tests).
   */
  readonly fetchApp?: (request: Request) => Promise<Response>;
}

/**
 * Resolve a URL pathname under `root` with traversal refusal.
 * @returns absolute file path, or `undefined` when outside root / bad encoding.
 */
export function resolveDesktopAssetPath(
  root: string,
  pathname: string,
): string | undefined {
  const base = path.resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const relative = decoded.replace(/^\/+/u, "");
  const target = path.resolve(path.normalize(path.join(base, relative)));
  if (target !== base && !target.startsWith(base + path.sep)) return undefined;
  return target;
}

/** Serve one static file for GET/HEAD from a trusted root. */
export async function serveDesktopStaticAsset(
  root: string,
  request: Request,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const url = new URL(request.url);
  const target = resolveDesktopAssetPath(root, url.pathname);
  if (target === undefined) return new Response(null, { status: 403 });
  try {
    if (request.method === "HEAD") {
      return new Response(null, {
        headers: {
          "content-type":
            MIME[path.extname(target)] ?? "application/octet-stream",
        },
      });
    }
    const fileBody = await readFile(target);
    // Static MVP: Host Fetch is unset — still inject __XRK_BOOT__ like server-http.
    const body = maybeInjectDesktopBootHtml(root, target, fileBody);
    return new Response(body, {
      headers: {
        "content-type": MIME[path.extname(target)] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** True when navigation / loadURL stays on the desktop custom protocol. */
export function isDesktopProtocolUrl(
  url: string,
  scheme: string = DESKTOP_PROTOCOL_SCHEME,
): boolean {
  try {
    return new URL(url).protocol === `${scheme}:`;
  } catch {
    return false;
  }
}

/**
 * Block navigations that leave the custom protocol (open handlers stay deny-all elsewhere).
 */
export function attachDesktopNavigationGuard(
  webContents: {
    on(
      event: "will-navigate",
      listener: (event: { preventDefault(): void }, url: string) => void,
    ): void;
  },
  scheme: string = DESKTOP_PROTOCOL_SCHEME,
): void {
  webContents.on("will-navigate", (event, url) => {
    if (!isDesktopProtocolUrl(url, scheme)) event.preventDefault();
  });
}

/** Primary product URL for the main window. */
export function desktopAppIndexUrl(
  scheme: string = DESKTOP_PROTOCOL_SCHEME,
): string {
  return `${scheme}://app/index.html`;
}

/**
 * Paths that must hit the Desktop Host Fetch carrier (not static webRoot).
 * `/api/*` = Face RPC; `/sidebar/*` = workbench / plan preview / better-sidebar;
 * product entry + boot = Host-merged first-party + ~/.xrk community clients.
 */
export function isDesktopHostForwardPath(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/sidebar" || pathname.startsWith("/sidebar/")) return true;
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/boot.json") return true;
  return false;
}

/**
 * Route one `xrk-app://` request: `shell` → shellRoot, Host routes → Fetch,
 * else static `webRoot` (with `/plugins/*` Host fallthrough for community clients).
 */
export async function handleDesktopProtocolRequest(
  request: Request,
  options: DesktopProtocolHandlerOptions,
  scheme: string = DESKTOP_PROTOCOL_SCHEME,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (url.protocol !== `${scheme}:`) {
    return new Response(null, { status: 400 });
  }
  if (url.hostname === "shell") {
    if (options.shellRoot === undefined) {
      return new Response(null, { status: 404 });
    }
    return serveDesktopStaticAsset(options.shellRoot, request);
  }
  // Face/API / sidebar / product entry must hit the Host carrier. Accept any
  // app-owned hostname so the renderer can put long-lived SSE on
  // `xrk-app://stream` (separate Chromium connection pool from unary
  // `xrk-app://app`).
  if (isDesktopHostForwardPath(url.pathname)) {
    if (options.fetchApp === undefined) {
      // Static MVP / tests: only product entry can fall through to webRoot.
      if (
        url.pathname === "/" ||
        url.pathname === "/index.html" ||
        url.pathname === "/boot.json"
      ) {
        if (url.hostname !== "app") {
          return new Response(null, { status: 404 });
        }
        return serveDesktopStaticAsset(options.webRoot, request);
      }
      return new Response(null, { status: 503 });
    }
    return options.fetchApp(request);
  }
  if (url.hostname !== "app") {
    return new Response(null, { status: 404 });
  }
  // Packaged first-party plugins first; community clients live in Host overlay.
  if (
    options.fetchApp !== undefined &&
    url.pathname.startsWith("/plugins/")
  ) {
    const fromDisk = await serveDesktopStaticAsset(options.webRoot, request);
    if (fromDisk.status !== 404) return fromDisk;
    return options.fetchApp(request);
  }
  return serveDesktopStaticAsset(options.webRoot, request);
}
