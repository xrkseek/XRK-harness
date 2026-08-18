import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

export interface WebStaticOptions {
  /** Absolute or cwd-relative dist root (e.g. apps/web/dist). */
  readonly root: string;
  /** Extra dist roots tried when the primary file is missing (plugin overlay). */
  readonly extraRoots?: readonly string[];
  /** Transform index.html (boot inject). */
  readonly transformIndex?: (html: string) => string;
}

function contentType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve URL pathname to a file under root. Returns null if outside root
 * or path is unsafe.
 */
export function resolveStaticPath(
  root: string,
  pathname: string,
): string | null {
  const rootAbs = path.resolve(root);
  let rel = decodeURIComponent(pathname.split("?")[0] ?? "/");
  if (rel.includes("\0")) return null;
  if (rel === "/" || rel === "") rel = "/index.html";
  // Force join under root (leading slash would ignore root on path.resolve)
  const trimmed = rel.replace(/^[/\\]+/, "");
  const candidate = path.resolve(rootAbs, trimmed);
  const relToRoot = path.relative(rootAbs, candidate);
  if (
    relToRoot.startsWith("..") ||
    path.isAbsolute(relToRoot) ||
    relToRoot.includes(`..${path.sep}`)
  ) {
    return null;
  }
  return candidate;
}

/**
 * Serve SPA static assets. Returns true if the response was claimed.
 * Public (no API key) — call before `/api` auth.
 */
export async function tryServeWebStatic(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebStaticOptions,
  extraHeaders: Record<string, string> = {},
): Promise<boolean> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    return false;
  }

  const rootAbs = path.resolve(options.root);
  if (!existsSync(rootAbs)) return false;

  let filePath = resolveStaticPath(rootAbs, url.pathname);
  if (!filePath) {
    res.writeHead(403, extraHeaders);
    res.end("forbidden");
    return true;
  }

  let st: ReturnType<typeof statSync> | undefined;
  try {
    st = statSync(filePath);
  } catch {
    st = undefined;
  }

  if (!st?.isFile()) {
    for (const extra of options.extraRoots ?? []) {
      const extraAbs = path.resolve(extra);
      if (!existsSync(extraAbs)) continue;
      const extraPath = resolveStaticPath(extraAbs, url.pathname);
      if (!extraPath) continue;
      try {
        const extraSt = statSync(extraPath);
        if (extraSt.isFile()) {
          filePath = extraPath;
          st = extraSt;
          break;
        }
      } catch {
        /* try next overlay */
      }
    }
  }

  if (!st?.isFile()) {
    if (url.pathname.startsWith("/plugins/")) {
      res.writeHead(404, extraHeaders);
      res.end("not found");
      return true;
    }
    // SPA fallback: non-file GETs → index.html
    const indexPath = path.join(rootAbs, "index.html");
    if (!existsSync(indexPath)) return false;
    filePath = indexPath;
  }

  const isIndex =
    path.basename(filePath) === "index.html" ||
    filePath.endsWith(`${path.sep}index.html`);

  if (isIndex && options.transformIndex) {
    let html = await readFile(filePath, "utf8");
    html = options.transformIndex(html);
    const buf = Buffer.from(html, "utf8");
    res.writeHead(200, {
      ...extraHeaders,
      "content-type": "text/html; charset=utf-8",
      "content-length": buf.length,
      "cache-control": "no-cache",
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.end(buf);
    return true;
  }

  const size = statSync(filePath).size;
  res.writeHead(200, {
    ...extraHeaders,
    "content-type": contentType(filePath),
    "content-length": size,
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", () => resolve());
    stream.pipe(res);
  });
  return true;
}
