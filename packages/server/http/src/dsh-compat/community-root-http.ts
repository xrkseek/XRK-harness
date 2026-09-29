/**
 * Community root paths such as `/whale-girl` and nested `/dsh-whale-girl/api/…`
 * (not `/api`, not capability-table prefixes that register earlier).
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import {
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./underlying/http-kit.js";
import {
  patchPluginSurface,
  readPluginSurface,
} from "./underlying/plugin-surface-store.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

const RESERVED_ROOT = new Set([
  "api",
  "sidebar",
  "modlens",
  "niulai-kws",
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
  "skin-assets",
  "dsh-genui",
  "turn-rewind",
  "auto-review",
  "tokenledger",
  "wallet",
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

export interface CommunityRootOptions {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
}

/**
 * First path segment + optional nested community surface under a `dsh-*` slug.
 *
 * Nested trees must NOT claim Cordis / settings RPC (`/dsh-foo-settings/get`,
 * `/dsh-pocket/pocket.status`) — those go to the RPC registry after HTTP
 * matches. Only `api/…` and staged static assets are community-root under
 * nested `dsh-*` paths.
 */
export function isCommunityRootPath(pathname: string): boolean {
  const m = /^\/([a-z][a-z0-9-]*)(\/.*)?$/.exec(pathname);
  if (!m) return false;
  const slug = m[1]!;
  if (RESERVED_ROOT.has(slug)) return false;
  const nested = m[2];
  // Exact `/slug` stays open for short aliases (`/whale-girl`).
  if (!nested) return true;
  // Nested `/slug/…` only for `dsh-*` packs; keep non-dsh nested as Host gaps.
  if (!slug.startsWith("dsh-")) return false;
  const tail = nested.slice(1);
  if (tail === "api" || tail.startsWith("api/")) return true;
  // Staged assets only — Cordis RPC methods may contain dots (`pocket.status`).
  const base = tail.split("/").pop() ?? "";
  return COMMUNITY_ASSET_EXT.has(path.extname(base).toLowerCase());
}

const COMMUNITY_ASSET_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".mp3",
  ".wav",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".html",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
]);


function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function stagedPluginRoots(
  pluginsDir: string | undefined,
  slug: string,
): string[] {
  if (!pluginsDir?.trim()) return [];
  const web = path.join(pluginsDir, "web", "plugins");
  const roots = [path.join(web, slug)];
  // Staged npm scopes flatten to `scope/name` dirs; also try bare short names.
  if (slug.startsWith("dsh-")) {
    roots.push(path.join(web, slug.slice(4)));
  } else {
    roots.push(path.join(web, `dsh-${slug}`));
  }
  return roots;
}

function tryServeStagedAsset(
  res: ServerResponse,
  method: string,
  pluginsDir: string | undefined,
  slug: string,
  rel: string,
): boolean {
  if (!rel || rel.includes("..")) return false;
  const safe = rel
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!safe) return false;
  for (const root of stagedPluginRoots(pluginsDir, slug)) {
    if (!existsSync(root)) continue;
    for (const candidate of [
      path.join(root, safe),
      path.join(root, "assets", safe),
      path.join(root, "static", safe),
    ]) {
      try {
        const st = statSync(candidate);
        if (!st.isFile()) continue;
        res.writeHead(200, {
          "content-type": contentType(candidate),
          "content-length": String(st.size),
          "cache-control": "no-store",
        });
        if (method === "HEAD") {
          res.end();
          return true;
        }
        createReadStream(candidate).pipe(res);
        return true;
      } catch {
        /* try next */
      }
    }
  }
  return false;
}

function apiTail(pathname: string, slug: string): string {
  const prefix = `/${slug}/`;
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length);
}

/**
 * Honest JSON (+ staged static assets) for community slug roots.
 * Specific capability prefixes register earlier and win first-match.
 * `api/state` · `api/config` persist under ~/.xrk/community-surfaces/<slug>/.
 */
export async function handleCommunityRootHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: CommunityRootOptions = {},
): Promise<boolean> {
  if (!isCommunityRootPath(pathname)) return false;
  const method = httpMethod(req);
  const m = /^\/([a-z][a-z0-9-]*)(\/.*)?$/.exec(pathname);
  const plugin = m?.[1] ?? pathname.slice(1);
  const tail = apiTail(pathname, plugin);
  const xrkHome = options.xrkHome;

  if ((method === "GET" || method === "HEAD") && tail) {
    const base = tail.split("/").pop() ?? "";
    if (path.extname(base)) {
      if (tryServeStagedAsset(res, method, options.pluginsDir, plugin, tail)) {
        return true;
      }
    }
  }

  // Whale-girl / desktop-pet style surfaces: keep shapes the client merges.
  if (tail === "api/state" || tail === "api/state.js" || tail === "api/workstate") {
    let surface = readPluginSurface(xrkHome, plugin);
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const patch =
        body.state && typeof body.state === "object" && !Array.isArray(body.state)
          ? (body.state as Record<string, unknown>)
          : body.value &&
              typeof body.value === "object" &&
              !Array.isArray(body.value)
            ? (body.value as Record<string, unknown>)
            : (() => {
                const {
                  action: _a,
                  ...rest
                } = body;
                return rest;
              })();
      if (Object.keys(patch).length > 0) {
        surface = patchPluginSurface(xrkHome, plugin, "state", patch, "merge");
      }
    }
    sendJson(
      res,
      200,
      tag({
        ok: true,
        balance:
          typeof surface.state.balance === "number" ? surface.state.balance : 0,
        provider: surface.state.provider ?? null,
        model: surface.state.model ?? null,
        status:
          typeof surface.state.status === "string"
            ? surface.state.status
            : "ready",
        ...surface.state,
        plugin,
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
        writable: true,
        revision: surface.revision,
      }),
    );
    return true;
  }

  if (tail === "api/config") {
    let surface = readPluginSurface(xrkHome, plugin);
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const patch =
        body.config && typeof body.config === "object" && !Array.isArray(body.config)
          ? (body.config as Record<string, unknown>)
          : body.value &&
              typeof body.value === "object" &&
              !Array.isArray(body.value)
            ? (body.value as Record<string, unknown>)
            : (() => {
                const { action: _a, ...rest } = body;
                return rest;
              })();
      if (Object.keys(patch).length > 0) {
        surface = patchPluginSurface(xrkHome, plugin, "config", patch, "merge");
      }
    }
    sendJson(
      res,
      200,
      tag({
        ok: true,
        config: surface.config,
        plugin,
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
        writable: true,
        revision: surface.revision,
      }),
    );
    return true;
  }

  if (isMutatingMethod(method)) {
    await parseJsonBody(req).catch(() => ({}));
  }

  if (tail === "api/providers") {
    sendJson(
      res,
      200,
      tag(
        {
          ok: true,
          providers: [],
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

  if (tail === "api/select-model") {
    sendJson(
      res,
      200,
      tag(
        {
          ok: true,
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

  if (tail.startsWith("api/") || tail === "api") {
    sendJson(
      res,
      200,
      tag(
        {
          ok: true,
          status: "ready",
          plugin,
          path: pathname,
          endpoint: tail,
          adapter: DSH_COMPAT_ADAPTER,
          writable: false,
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
