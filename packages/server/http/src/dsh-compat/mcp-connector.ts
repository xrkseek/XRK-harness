/**
 * dsh-mcp-connector — POST `/mcp-connector/api` with persisted connection catalog.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readBody, sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { findCommunityPluginRoot } from "./community-plugin-root.js";

export interface McpConnectorHttpOptions {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
}

interface McpConnection {
  id: string;
  name: string;
  transport: string;
  command?: string;
  url?: string;
  enabled: boolean;
  createdAt: string;
}

interface McpDoc {
  connections: McpConnection[];
  servers: unknown[];
}

const STORE = createXrkDocStore<McpDoc>(["dsh-mcp-connector", "state.json"], {
  connections: [],
  servers: [],
});

export function isMcpConnectorPath(pathname: string): boolean {
  return (
    pathname === "/mcp-connector" || pathname.startsWith("/mcp-connector/")
  );
}

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function parseJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function detailForMethod(
  method: string,
  xrkHome: string | undefined,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const doc = STORE.read(xrkHome).data;
  switch (method) {
    case "versionStatus":
      return {
        current: null,
        latest: null,
        updateAvailable: false,
        checkedAt: Date.now(),
        adapter: DSH_COMPAT_ADAPTER,
      };
    case "listConnections":
    case "list":
      return { connections: doc.connections, items: doc.connections };
    case "catalog":
      return { servers: doc.servers, items: doc.servers };
    case "health":
    case "status":
      return {
        ok: true,
        state: doc.connections.some((c) => c.enabled) ? "configured" : "idle",
        connections: doc.connections,
      };
    case "upsertConnection":
    case "addConnection":
    case "saveConnection": {
      const id =
        typeof body.id === "string" && body.id ? body.id : randomUUID();
      const row: McpConnection = {
        id,
        name: typeof body.name === "string" ? body.name : id,
        transport:
          typeof body.transport === "string" ? body.transport : "stdio",
        ...(typeof body.command === "string" ? { command: body.command } : {}),
        ...(typeof body.url === "string" ? { url: body.url } : {}),
        enabled: body.enabled !== false,
        createdAt: new Date().toISOString(),
      };
      STORE.patch(xrkHome, (current) => ({
        ...current,
        connections: [
          ...current.connections.filter((c) => c.id !== id),
          row,
        ],
      }));
      return {
        ok: true,
        connection: row,
        connections: STORE.read(xrkHome).data.connections,
      };
    }
    case "removeConnection":
    case "deleteConnection": {
      const id = typeof body.id === "string" ? body.id : "";
      STORE.patch(xrkHome, (current) => ({
        ...current,
        connections: current.connections.filter((c) => c.id !== id),
      }));
      return {
        ok: true,
        connections: STORE.read(xrkHome).data.connections,
      };
    }
    default:
      return {
        ok: true,
        method,
        adapter: DSH_COMPAT_ADAPTER,
      };
  }
}

export async function handleMcpConnectorHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: McpConnectorHttpOptions = {},
): Promise<boolean> {
  if (!isMcpConnectorPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (
    (pathname === "/mcp-connector/api" || pathname === "/mcp-connector/api/") &&
    method === "POST"
  ) {
    const body = await parseJson(req);
    const rpc =
      typeof body.method === "string" ? body.method : "versionStatus";
    const args =
      body.params && typeof body.params === "object"
        ? (body.params as Record<string, unknown>)
        : body;
    sendJson(res, 200, {
      ok: true,
      detail: detailForMethod(rpc, options.xrkHome, args),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    pathname.startsWith("/mcp-connector/ui/") &&
    (method === "GET" || method === "HEAD")
  ) {
    const root = findCommunityPluginRoot(options.pluginsDir, [
      "dsh-mcp-connector",
    ]);
    const rel = pathname.slice("/mcp-connector/ui/".length);
    if (root && rel && !rel.includes("..") && !path.isAbsolute(rel)) {
      const abs = path.resolve(root, "ui", rel);
      const base = path.resolve(root, "ui");
      if (
        (abs === base || abs.startsWith(base + path.sep)) &&
        existsSync(abs)
      ) {
        try {
          const st = statSync(abs);
          if (st.isFile()) {
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
          }
        } catch {
          /* fall through */
        }
      }
    }
    sendJson(res, 404, {
      ok: false,
      error: "mcp-connector ui asset missing",
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
    detail: detailForMethod("status", options.xrkHome, {}),
  });
  return true;
}
