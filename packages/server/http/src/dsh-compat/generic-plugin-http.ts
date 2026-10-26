/**
 * Community plugin static assets under `/plugins/<id>/…` (chunks · css · json).
 * API-shaped paths return honest JSON. Unmatched platform bundles fall through to webDist.
 */
import { createReadStream, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createGzip } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

/** Same set web static uses — community plugin JS can be multi‑MB (office). */
const GZIP_EXTS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".map",
  ".txt",
  ".html",
]);

function acceptGzip(req: IncomingMessage): boolean {
  const raw = req.headers["accept-encoding"];
  if (raw === undefined) return false;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  return /(?:^|,)\s*gzip(?:\s|;|,|$)/i.test(value);
}

export interface PluginAssetOptions {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
}

interface AgentTeamRow {
  id: string;
  name: string;
  plan?: string;
  status: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AgentTeamsDoc {
  teams: AgentTeamRow[];
}

const AGENT_TEAMS_STORE = createXrkDocStore<AgentTeamsDoc>(
  ["dsh-agent-teams", "teams.json"],
  { teams: [] },
);

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

/**
 * Cordis host halves (WorkBuddy status/probe/update) register after this
 * catch-all. Yield so those exact routes are not shadowed by stub/404 JSON.
 */
export function looksCordisHostApiTail(tail: string): boolean {
  if (!tail) return false;
  const base = tail.split("/").pop() ?? "";
  return base === "status" || base === "probe" || base === "update";
}

function tryServePluginFile(
  req: IncomingMessage,
  res: ServerResponse,
  abs: string,
  method: string,
): boolean {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    const ext = path.extname(abs).toLowerCase();
    // Office preview ships ~22 MB uncompressed; without gzip the classic
    // `<script src>` often fires `error` before parse. Mirror apps/web static.
    const gzip = acceptGzip(req) && GZIP_EXTS.has(ext);
    const headers: Record<string, string> = {
      "content-type": contentType(abs),
      "cache-control": "no-store",
    };
    if (gzip) {
      headers["content-encoding"] = "gzip";
      headers.vary = "Accept-Encoding";
    } else {
      headers["content-length"] = String(st.size);
    }
    res.writeHead(200, headers);
    if (method === "HEAD") {
      res.end();
      return true;
    }
    const stream = createReadStream(abs);
    if (!gzip) {
      stream.pipe(res);
      return true;
    }
    stream.pipe(createGzip()).pipe(res);
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
  let mutateBody: Record<string, unknown> = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    try {
      const raw = await readBody(req);
      mutateBody = raw.trim()
        ? (JSON.parse(raw) as Record<string, unknown>)
        : {};
    } catch {
      mutateBody = {};
    }
  }

  const { pluginId, tail } = parsePluginPath(pathname);
  if (looksCordisHostApiTail(tail)) return false;

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
      if (tryServePluginFile(req, res, abs, method)) return true;
    }
  }

  // @nanmicoder/dsh-agent-teams — persisted team catalog (run/halt stay local).
  if (
    pluginId === "dsh-agent-teams" ||
    pluginId.endsWith("/dsh-agent-teams")
  ) {
    const xrkHome = options.xrkHome;
    if (tail === "state" || tail.startsWith("state?")) {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const archived = url.searchParams.get("archived") === "1";
      const teams = AGENT_TEAMS_STORE.read(xrkHome).data.teams.filter((t) =>
        archived ? t.archived : !t.archived,
      );
      sendJson(res, 200, {
        teams,
        ...(archived ? { archived: true } : {}),
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (tail === "plan" && method === "POST") {
      const body = mutateBody;
      const now = new Date().toISOString();
      const id =
        typeof body.id === "string" && body.id ? body.id : randomUUID();
      const row: AgentTeamRow = {
        id,
        name:
          typeof body.name === "string"
            ? body.name
            : `team-${id.slice(0, 8)}`,
        ...(typeof body.plan === "string" ? { plan: body.plan } : {}),
        status: "planned",
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      AGENT_TEAMS_STORE.patch(xrkHome, (doc) => ({
        teams: [...doc.teams.filter((t) => t.id !== id), row],
      }));
      sendJson(res, 200, {
        ok: true,
        team: row,
        teams: AGENT_TEAMS_STORE.read(xrkHome).data.teams.filter(
          (t) => !t.archived,
        ),
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (tail === "halt" && method === "POST") {
      const body = mutateBody;
      const id = typeof body.id === "string" ? body.id : "";
      const now = new Date().toISOString();
      AGENT_TEAMS_STORE.patch(xrkHome, (doc) => ({
        teams: doc.teams.map((t) =>
          !id || t.id === id
            ? { ...t, status: "halted", updatedAt: now }
            : t,
        ),
      }));
      sendJson(res, 200, {
        ok: true,
        teams: AGENT_TEAMS_STORE.read(xrkHome).data.teams.filter(
          (t) => !t.archived,
        ),
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
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
  return pathname.startsWith("/plugins/");
}
