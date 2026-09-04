/**
 * Host sidebar HTML preview: GET /sidebar/html/<sessionId>/<abs-path-segments…>
 * Serves workspace files with real MIME so the iframe does not fall through to the SPA.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";

const HTML_PREFIX = "/sidebar/html/";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function fail(code: string, message: string): unknown {
  return { ok: false, error: { code, message } };
}

/** Decode `/sidebar/html/<session>/<segments…>` into an absolute filesystem path. */
export function decodeSidebarHtmlPath(pathname: string): {
  sessionId: string;
  absPath: string;
} | undefined {
  if (!pathname.startsWith(HTML_PREFIX)) return undefined;
  const rest = pathname.slice(HTML_PREFIX.length);
  if (!rest) return undefined;
  const parts = rest.split("/").filter((p) => p.length > 0);
  if (parts.length < 2) return undefined;
  // UNC: /sidebar/html/<session>//server/share/... → empty segment after session
  const rawSplit = rest.split("/");
  const sessionAt = rawSplit.findIndex((p) => p.length > 0);
  if (sessionAt < 0) return undefined;
  const sessionEnc = rawSplit[sessionAt]!;
  const afterSession = rawSplit.slice(sessionAt + 1);
  const unc = afterSession[0] === "" && afterSession.length > 1;
  const pathParts = (unc ? afterSession.slice(1) : afterSession).filter(
    (p) => p.length > 0,
  );
  if (pathParts.length === 0) return undefined;
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(sessionEnc);
  } catch {
    return undefined;
  }
  const decoded = pathParts.map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  // Windows drive: first segment "C:" + rest → C:\...
  if (/^[A-Za-z]:$/.test(decoded[0]!)) {
    const absPath = path.win32.join(`${decoded[0]!}\\`, ...decoded.slice(1));
    return { sessionId, absPath };
  }
  if (unc) {
    return {
      sessionId,
      absPath: path.win32.join("\\\\" + decoded[0]!, ...decoded.slice(1)),
    };
  }
  // POSIX absolute
  return { sessionId, absPath: path.posix.join("/", ...decoded) };
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function underRoot(root: string, target: string): boolean {
  const rootResolved = path.resolve(root);
  const abs = path.resolve(target);
  return (
    abs === rootResolved || abs.startsWith(rootResolved + path.sep)
  );
}

export interface SidebarHtmlOptions {
  readonly resolveSessionCwd?: (sessionId: string) => string | undefined;
  readonly defaultCwd?: string;
}

/**
 * Serve one file for the HTML preview iframe (and its relative assets).
 * @returns true when the request was handled.
 */
export async function handleSidebarHtml(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SidebarHtmlOptions,
): Promise<boolean> {
  if (!pathname.startsWith(HTML_PREFIX)) return false;
  if ((_req.method ?? "GET").toUpperCase() !== "GET") {
    sendJson(res, 405, fail("method", "GET required"));
    return true;
  }
  const decoded = decodeSidebarHtmlPath(pathname);
  if (!decoded) {
    sendJson(res, 400, fail("bad-request", "invalid html preview path"));
    return true;
  }
  const cwd =
    (decoded.sessionId && options.resolveSessionCwd
      ? options.resolveSessionCwd(decoded.sessionId)
      : undefined) ?? options.defaultCwd ?? process.cwd();
  const abs = path.resolve(decoded.absPath);
  if (!underRoot(cwd, abs) && !underRoot(path.resolve(cwd), abs)) {
    // Allow absolute paths that resolve inside cwd only (same fence as relative).
    sendJson(res, 403, fail("path", "html preview path escapes workspace"));
    return true;
  }
  if (!existsSync(abs)) {
    sendJson(res, 404, fail("not-found", "file missing"));
    return true;
  }
  const st = statSync(abs);
  if (!st.isFile()) {
    sendJson(res, 400, fail("not-file", "not a file"));
    return true;
  }
  res.writeHead(200, {
    "content-type": mimeFor(abs),
    "content-length": st.size,
    // Preview iframes must not be framed as the product SPA; no CSP that blocks scripts in games.
    "x-content-type-options": "nosniff",
  });
  createReadStream(abs).pipe(res);
  return true;
}
