/**
 * Custom `xrk-app://` protocol: version-matched static Web assets + navigation guard (ADR-0008).
 * Fetch to Desktop Host for `app` hostname is injectable; Node IPC stays lifecycle-only.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DESKTOP_PROTOCOL_SCHEME } from "./desktop-bootstrap.js";

export { DESKTOP_PROTOCOL_SCHEME };

/** Privileges for `protocol.registerSchemesAsPrivileged` before app ready. */
export const DESKTOP_PROTOCOL_PRIVILEGES = {
  scheme: DESKTOP_PROTOCOL_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
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
  ".woff2": "font/woff2",
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
    const body = request.method === "HEAD" ? null : await readFile(target);
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
 * Route one `xrk-app://` request: `shell` → shellRoot, `app` → Host Fetch or webRoot.
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
  if (url.hostname !== "app") {
    return new Response(null, { status: 404 });
  }
  if (options.fetchApp !== undefined) {
    return options.fetchApp(request);
  }
  return serveDesktopStaticAsset(options.webRoot, request);
}
