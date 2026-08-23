/**
 * 底层：社区插件 `/plugins/<id>/…` 静态资产（chunks · css · json）。
 * API 形路径仍返回诚实 JSON。平台内置 bundle 未命中时 fall through 给 webDist。
 */
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

export interface PluginAssetOptions {
  readonly pluginsDir?: string;
}

function pluginDir(
  pluginsDir: string | undefined,
  pluginId: string,
): string | undefined {
  if (!pluginsDir?.trim()) return undefined;
  const root = path.join(pluginsDir, "web", "plugins");
  if (pluginId.includes("/")) {
    return path.join(root, ...pluginId.split("/"));
  }
  return path.join(root, pluginId);
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".html":
      return "text/html; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function parsePluginPath(pathname: string): {
  pluginId: string;
  tail: string;
} {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[1]?.startsWith("@") && parts[2]) {
    return {
      pluginId: `${parts[1]}/${parts[2]}`,
      tail: parts.slice(3).join("/"),
    };
  }
  return {
    pluginId: parts[1] ?? "unknown",
    tail: parts.slice(2).join("/"),
  };
}

function looksStaticAssetTail(tail: string): boolean {
  if (!tail) return false;
  const base = tail.split("/").pop() ?? "";
  const ext = path.extname(base).toLowerCase();
  return Boolean(ext) && ext !== ".action";
}

function looksApiTail(tail: string): boolean {
  if (!tail) return true;
  const base = tail.split("/").pop() ?? "";
  return (
    base === "status" ||
    base === "config" ||
    base === "state" ||
    base === "health" ||
    tail.startsWith("api/") ||
    tail.endsWith(".action")
  );
}

function tryServePluginFile(
  res: ServerResponse,
  abs: string,
  method: string,
): boolean {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      "content-type": contentType(abs),
      "content-length": String(st.size),
      "cache-control": "no-store",
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(abs).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export async function handlePluginAssetHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: PluginAssetOptions = {},
): Promise<boolean> {
  if (!pathname.startsWith("/plugins/")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }

  const { pluginId, tail } = parsePluginPath(pathname);
  const baseDir = pluginDir(options.pluginsDir, pluginId);

  if (baseDir && tail && (method === "GET" || method === "HEAD")) {
    const safe = tail
      .split("/")
      .filter((seg) => seg && seg !== "." && seg !== "..")
      .join("/");
    const abs = path.join(baseDir, safe);
    const baseResolved = path.resolve(baseDir);
    const targetResolved = path.resolve(abs);
    if (
      targetResolved.startsWith(baseResolved + path.sep) ||
      targetResolved === baseResolved
    ) {
      if (tryServePluginFile(res, abs, method)) return true;
    }
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { error: "method not allowed", adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  // Static asset miss — let webDist try; API-only tails stay on this handler.
  if (!looksApiTail(tail) && looksStaticAssetTail(tail)) return false;

  if (!looksApiTail(tail)) {
    sendJson(res, 404, {
      error: "not found",
      plugin: pluginId,
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        plugin: pluginId,
        path: pathname,
        assets: [],
        state: {},
        adapter: DSH_COMPAT_ADAPTER,
        note: "Plugin API host route; static file missing or API-only surface.",
      },
      ["plugin-asset-host"],
    ),
  );
  return true;
}

export function isPluginAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/plugins/") && !pathname.startsWith("/plugins/install")
  );
}
