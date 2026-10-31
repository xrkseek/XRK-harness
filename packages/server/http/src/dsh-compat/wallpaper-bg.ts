/**
 * Host bridge for `dsh-wallpaper-bg` (built-in webp set + optional WE proxy).
 *
 * Unlike `dsh-plugin-wallpaper-engine` (Steam scan / upload only), this pack
 * ships `assets/builtin/full-*.webp`. XRK serves those + honest /health · /we
 * stubs — no Cordis Host apply, no WE desktop API.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { httpMethod } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";
import { findCommunityPluginRoot } from "./community-plugin-root.js";

export interface WallpaperBgOptions {
  readonly pluginsDir?: string;
}

const BASE = "/dsh-wallpaper-bg";
const BUILTIN_RE = /^(?:thumb|full)-\d{2}\.(?:webp|avif|png|jpe?g)$/i;

export function isWallpaperBgPath(pathname: string): boolean {
  return pathname === BASE || pathname.startsWith(`${BASE}/`);
}

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function builtinDir(options: WallpaperBgOptions): string | undefined {
  const root = findCommunityPluginRoot(options.pluginsDir, [
    "dsh-wallpaper-bg",
  ]);
  if (!root) return undefined;
  const dir = path.join(root, "assets", "builtin");
  return existsSync(dir) ? dir : undefined;
}

function listBuiltinItems(dir: string | undefined): Record<string, unknown>[] {
  if (!dir) return [];
  const files = readdirSync(dir).filter((n) => /^full-\d{2}\./i.test(n));
  files.sort();
  return files.map((name, i) => {
    const n = String(i + 1).padStart(2, "0");
    const thumb = `thumb-${n}.webp`;
    return {
      id: `builtin-${i + 1}`,
      title: name,
      source: "builtin",
      type: "image",
      url: `${BASE}/builtin/${name}`,
      thumbnail: existsSync(path.join(dir, thumb))
        ? `${BASE}/builtin/${thumb}`
        : `${BASE}/builtin/${name}`,
    };
  });
}

function serveBuiltin(
  res: ServerResponse,
  method: string,
  dir: string | undefined,
  name: string,
): boolean {
  if (!dir || !BUILTIN_RE.test(name) || path.basename(name) !== name) {
    return false;
  }
  const abs = path.join(dir, name);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      "content-type": contentType(abs),
      "content-length": String(st.size),
      "cache-control": "public, max-age=86400",
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

export async function handleWallpaperBgHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: WallpaperBgOptions = {},
): Promise<boolean> {
  if (!isWallpaperBgPath(pathname)) return false;
  const method = httpMethod(req);
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, tag({ ok: false, error: "method not allowed" }));
    return true;
  }

  const dir = builtinDir(options);
  const rel = pathname === BASE ? "" : pathname.slice(BASE.length + 1);

  if (rel === "health" || rel === "") {
    sendJson(
      res,
      200,
      tag({
        ok: true,
        plugin: "dsh-wallpaper-bg",
        // No WE desktop API on XRK — client falls back to built-ins.
        monitorForward: 0,
        discoverWeApi: 0,
        builtinCount: listBuiltinItems(dir).length,
        adapter: DSH_COMPAT_ADAPTER,
      }),
    );
    return true;
  }

  if (rel.startsWith("builtin/")) {
    const name = decodeURIComponent(rel.slice("builtin/".length));
    if (serveBuiltin(res, method, dir, name)) return true;
    sendJson(res, 404, tag({ ok: false, error: "builtin not found", name }));
    return true;
  }

  if (rel === "we") {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const action = (url.searchParams.get("action") ?? "list").toLowerCase();
    const items = listBuiltinItems(dir);
    if (action === "ping") {
      sendJson(res, 200, tag({ ok: true, we: false, note: "no WE API on XRK" }));
      return true;
    }
    if (action === "current") {
      sendJson(
        res,
        200,
        tag({
          current: items[0] ?? null,
          monitor: "",
          monitorSource: "xrk-builtin",
          monitors: [],
        }),
      );
      return true;
    }
    // list (default)
    sendJson(res, 200, tag({ wallpapers: items, weAssetsAvailable: false }));
    return true;
  }

  if (rel === "asset" || rel.startsWith("asset")) {
    sendJson(
      res,
      200,
      tag(
        {
          ok: false,
          note: "Local WE asset proxy not on XRK; use /dsh-wallpaper-bg/builtin/…",
        },
        ["dsh-host"],
      ),
    );
    return true;
  }

  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        plugin: "dsh-wallpaper-bg",
        path: pathname,
        note: "Use /health · /builtin/… · /we?action=list|current|ping",
      },
      ["dsh-host"],
    ),
  );
  return true;
}
