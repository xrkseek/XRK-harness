/**
 * 通用 GET 兜底 — 能力表未覆盖的社区 HTTP 仍返回 JSON，不落 SPA 空白。
 * 注册在 registry 最末；POST 返回 false 交给 RPC / settings 兜底。
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

const SKIP_PREFIXES = [
  "/api/harness/",
  "/xrk/",
  "/console",
  "/assets/",
  "/favicon",
  "/plugins/",
];

function looksStaticFilePath(pathname: string): boolean {
  const base = pathname.split("/").pop() ?? "";
  const ext = path.extname(base).toLowerCase();
  return Boolean(ext) && ext !== ".action";
}

export function shouldHonestHttpCatchall(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  if (looksStaticFilePath(pathname)) return false;
  for (const p of SKIP_PREFIXES) {
    if (pathname === p || pathname.startsWith(p)) return false;
  }
  return true;
}

export async function handleHonestHttpCatchall(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!shouldHonestHttpCatchall(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  if (method === "HEAD") {
    res.writeHead(200, { "content-length": "0", "cache-control": "no-store" });
    res.end();
    return true;
  }
  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        status: "ready",
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
        writable: false,
        note: "XRK honest HTTP catch-all for uncovered community client paths.",
      },
      ["dsh-host"],
    ),
  );
  return true;
}

export function registerHonestHttpCatchall(registry: {
  registerHttp: (
    match: (pathname: string) => boolean,
    handle: (
      req: IncomingMessage,
      res: ServerResponse,
      pathname: string,
    ) => boolean | Promise<boolean>,
  ) => void;
}): void {
  registry.registerHttp(
    (pathname) => shouldHonestHttpCatchall(pathname),
    handleHonestHttpCatchall,
  );
}
