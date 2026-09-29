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
   * `{pluginsDir}/web` community overlay — merged into static boot inject and
   * used as `/plugins/*` fallthrough when Host Fetch is unset.
   */
  readonly overlayRoot?: string;
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
  options: { readonly overlayRoot?: string } = {},
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
    const body = maybeInjectDesktopBootHtml(root, target, fileBody, {
      ...(options.overlayRoot !== undefined
        ? { overlayRoot: options.overlayRoot }
        : {}),
    });
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

/** True when URL is the Desktop Host loopback Face (127.0.0.1 only). */
export function isDesktopLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Block navigations that leave the product surface (custom protocol or Host loopback).
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
    if (isDesktopProtocolUrl(url, scheme) || isDesktopLoopbackUrl(url)) return;
    event.preventDefault();
  });
}

/** Frameless Desktop titlebar strip (px) — matches AppFrame chrome height. */
export const DESKTOP_TITLEBAR_INSET_PX = 36

/**
 * Primary product URL for the main window (custom-protocol splash / legacy).
 * Stamps `dsh-desktop-*` query params so community workbenches
 * (`xrkh-better-sidebar`) yield the custom titlebar via their public contract.
 */
export function desktopAppIndexUrl(
  scheme: string = DESKTOP_PROTOCOL_SCHEME,
  options?: {
    readonly platform?: NodeJS.Platform
    readonly titlebarInset?: number
  },
): string {
  const platform = options?.platform ?? process.platform
  const inset = options?.titlebarInset ?? DESKTOP_TITLEBAR_INSET_PX
  const params = new URLSearchParams({
    "dsh-desktop-mode": "advanced",
    "dsh-desktop-platform": platform,
    "dsh-desktop-titlebar-inset": String(inset),
  })
  return `${scheme}://app/index.html?${params.toString()}`
}

/**
 * Product UI URL on the Host loopback origin (DSH Desktop posture).
 * Same `dsh-desktop-*` query stamps as {@link desktopAppIndexUrl}.
 */
export function desktopLoopbackIndexUrl(
  origin: string,
  options?: {
    readonly platform?: NodeJS.Platform
    readonly titlebarInset?: number
  },
): string {
  const platform = options?.platform ?? process.platform
  const inset = options?.titlebarInset ?? DESKTOP_TITLEBAR_INSET_PX
  const url = new URL("/index.html", origin.replace(/\/$/u, ""))
  url.searchParams.set("dsh-desktop-mode", "advanced")
  url.searchParams.set("dsh-desktop-platform", platform)
  url.searchParams.set("dsh-desktop-titlebar-inset", String(inset))
  return url.href
}

/**
 * True when a pathname looks like a packaged Web static asset (hashed `/assets/*`
 * or a common static extension). Host fallthrough must not SPA-fake these misses.
 */
export function isDesktopStaticAssetPath(pathname: string): boolean {
  if (pathname === "/assets" || pathname.startsWith("/assets/")) return true;
  return /\.(?:js|mjs|cjs|css|map|woff2?|ttf|otf|png|jpe?g|gif|svg|ico|webp|html)$/iu.test(
    pathname,
  );
}

/**
 * Paths that must hit the Desktop Host Fetch carrier (not static webRoot).
 * `/api/*` = Face RPC; `/sidebar/*` = workbench; `/boot.json` = Host-merged boot;
 * dsh-compat surfaces (`/modlens`, `/_dsh/`, …) = community Host HTTP.
 *
 * Product entry (`/` · `/index.html`) stays on packaged disk for first paint —
 * Host Fetch is optional and must not block the shell window.
 *
 * When Host Fetch is up, {@link handleDesktopProtocolRequest} also forwards every
 * other non-static path (and all non-GET/HEAD) — this list is the early / Host-down set.
 */
export function isDesktopHostForwardPath(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/sidebar" || pathname.startsWith("/sidebar/")) return true;
  if (pathname === "/boot.json") return true;
  // High-traffic dsh-compat prefixes (avoid a wasted static miss on every probe).
  if (pathname === "/modlens" || pathname.startsWith("/modlens/")) return true;
  if (pathname === "/modsearch" || pathname.startsWith("/modsearch/")) return true;
  if (pathname === "/niulai-kws" || pathname.startsWith("/niulai-kws/")) return true;
  if (pathname === "/auto-review" || pathname.startsWith("/auto-review/")) return true;
  if (pathname === "/skin-assets" || pathname.startsWith("/skin-assets/")) return true;
  if (pathname.startsWith("/_dsh/")) return true;
  return false;
}

function isMutatingMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

/**
 * Route one `xrk-app://` request: `shell` → shellRoot, Host routes → Fetch,
 * else static `webRoot` (with `/plugins/*` Host fallthrough for community clients).
 *
 * Host-up contract (fetchApp set):
 * - known Host surfaces + mutating methods → Host immediately
 * - `/plugins/*` → packaged disk, then Host, then overlay
 * - static asset paths → disk only (honest 404)
 * - everything else → Host (community roots · unlisted dsh-compat · …)
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
  const staticOpts =
    options.overlayRoot !== undefined
      ? { overlayRoot: options.overlayRoot }
      : {};
  if (url.hostname === "shell") {
    if (options.shellRoot === undefined) {
      return new Response(null, { status: 404 });
    }
    return serveDesktopStaticAsset(options.shellRoot, request);
  }

  const fetchApp = options.fetchApp;
  const hostUp = fetchApp !== undefined;

  // First paint: product HTML from packaged webRoot even while Host is warming
  // (static boot inject still merges overlayRoot). Face / boot.json / sidebar wait.
  if (
    url.hostname === "app" &&
    (url.pathname === "/" || url.pathname === "/index.html") &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const indexUrl =
      url.pathname === "/"
        ? new URL("/index.html", request.url).href
        : request.url;
    return serveDesktopStaticAsset(
      options.webRoot,
      new Request(indexUrl, { method: request.method, headers: request.headers }),
      staticOpts,
    );
  }

  // Face/API / sidebar / boot must hit the Desktop Host Fetch carrier.
  // Accept any app-owned hostname so the renderer can put long-lived SSE on
  // `xrk-app://stream` (separate Chromium connection pool from unary
  // `xrk-app://app`).
  if (isDesktopHostForwardPath(url.pathname)) {
    if (!hostUp) {
      // Host-down: serve packaged boot.json so the shell can mount before Face.
      if (url.pathname === "/boot.json") {
        if (url.hostname !== "app") {
          return new Response(null, { status: 404 });
        }
        return serveDesktopStaticAsset(options.webRoot, request, staticOpts);
      }
      return new Response(null, { status: 503 });
    }
    return fetchApp(request);
  }

  if (url.hostname !== "app") {
    return new Response(null, { status: 404 });
  }

  // Mutating verbs are never static files — do not let serveDesktopStaticAsset
  // answer 405 before Host (e.g. POST /dsh-market/install).
  if (hostUp && isMutatingMethod(request.method)) {
    return fetchApp(request);
  }

  // Packaged first-party plugins first; community clients live in Host overlay
  // (or local overlayRoot when Host Fetch is unset).
  if (url.pathname.startsWith("/plugins/")) {
    const fromDisk = await serveDesktopStaticAsset(options.webRoot, request);
    if (fromDisk.status !== 404) return fromDisk;
    if (hostUp) return fetchApp(request);
    if (options.overlayRoot !== undefined) {
      return serveDesktopStaticAsset(options.overlayRoot, request);
    }
    return fromDisk;
  }

  // Hashed /assets and extensioned statics stay on disk (honest miss = 404).
  if (isDesktopStaticAssetPath(url.pathname)) {
    return serveDesktopStaticAsset(options.webRoot, request, staticOpts);
  }

  // Host-up: every remaining path is a Host surface (community root, unlisted
  // dsh-compat prefix, …). Skip a wasted static 404 round-trip.
  if (hostUp) return fetchApp(request);

  // Host-down static MVP: try disk; miss stays 404.
  return serveDesktopStaticAsset(options.webRoot, request, staticOpts);
}
