/**
 * Generic GET catch-all — unlisted community HTTP still returns JSON (no blank SPA).
 * Registered last; POST returns false for RPC / settings fallback.
 *
 * Never claim `status: "ready"` here: that fooled Settings panels into treating
 * the envelope as domain data (e.g. OFM `data.catalog.filter`). Real adapters
 * and Cordis host halves register earlier and win.
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { incompleteCommunityApiBody } from "./incomplete-api-shapes.js";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

const SKIP_PREFIXES = [
  "/api/harness/",
  // Host cron API (`createCronApiHandler` in tryHandleExtraApi) — must
  // not be claimed here or Settings → Plugins → Tasks gets a stub body.
  "/api/cron/",
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
  const shaped = incompleteCommunityApiBody(pathname);
  if (shaped) {
    sendJson(res, 200, tag(shaped, ["dsh-host"]));
    return true;
  }
  sendJson(
    res,
    200,
    tag(
      {
        ok: false,
        status: "incomplete",
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
        writable: false,
        note: "XRK honest HTTP catch-all — no Cordis / dsh-compat handler claimed this path.",
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
