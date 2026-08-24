/**
 * Community root paths such as `/whale-girl` (not `/api`, not capability-table prefixes).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

const RESERVED_ROOT = new Set([
  "api",
  "sidebar",
  "modlens",
  "modsearch",
  "releases",
  "health",
  "plugins",
  "import",
  "default",
  "preview",
  "latest",
  "office",
  "tongflow",
  "mobile-access",
  "wallpaper-engine",
  "dream-skin",
  "dsh-market",
  "dsh-skin-market",
  "turn-rewind",
  "auto-review",
  "tokenledger",
  "weixin",
  "feishu",
  "dingtalk",
  "qq",
  "wecom",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
]);

export function isCommunityRootPath(pathname: string): boolean {
  const m = /^\/([a-z][a-z0-9-]*)$/.exec(pathname);
  if (!m) return false;
  return !RESERVED_ROOT.has(m[1]!);
}

export async function handleCommunityRootHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!isCommunityRootPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }
  const plugin = pathname.slice(1);
  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        status: "ready",
        plugin,
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
        writable: false,
      },
      ["dsh-host"],
    ),
  );
  return true;
}
