/**
 * Shared Cordis `connection` surface for community host halves.
 *
 * - `admit` / `requestRejection`: OFM trust fence (and peers) require these when
 *   `connection` is provided; missing admit → 503 "admission unavailable".
 * - `fetch.register`: DSH channel-pack (and similar) register Fetch handlers;
 *   late registers after compose seal use `registerDshCompatHttpLate`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CordisHttpHandler } from "./cordis-registry.js";
import { registerDshCompatHttpLate } from "./shared-registry.js";
import { readBodyBuffer } from "./underlying/http-json.js";
import type { XrkWebServerRoute } from "./xrk-host-apply.js";

export interface CordisFetchRoute {
  readonly path: string;
  readonly methods?: readonly string[];
  readonly requestBody?: string;
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

export type CordisHttpRow = {
  match: (pathname: string) => boolean;
  handle: CordisHttpHandler;
};

/** Exact / prefix pathname matcher shared by webServer + connection.fetch. */
export function matchWebServerRoute(
  route: Pick<XrkWebServerRoute, "path" | "kind">,
): (pathname: string) => boolean {
  const p = route.path.endsWith("/") ? route.path.slice(0, -1) : route.path;
  const kind = route.kind ?? "prefix";
  if (kind === "exact") {
    return (pathname) => pathname === p;
  }
  const prefix = p.endsWith("/") ? p : `${p}/`;
  return (pathname) => pathname === p || pathname.startsWith(prefix);
}

/** Push a Cordis `webServer.register` route onto a host HTTP contribution list. */
export function pushCordisWebServerRoute(
  http: CordisHttpRow[],
  route: XrkWebServerRoute,
): void {
  const methods = route.methods?.map((m) => m.toUpperCase());
  const match = matchWebServerRoute(route);
  http.push({
    match,
    handle: async (req, res, pathname) => {
      const method = (req.method ?? "GET").toUpperCase();
      if (methods?.length && !methods.includes(method)) {
        // Path claimed — do not fall through to honest "incomplete".
        res.writeHead(405, {
          allow: methods.join(", "),
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: "method not allowed",
            allow: methods,
          }),
        );
        return true;
      }
      const result = await route.handler(req, res, pathname);
      return result === undefined ? true : Boolean(result);
    },
  });
}

async function incomingToFetchRequest(
  req: IncomingMessage,
  pathname: string,
): Promise<Request> {
  const host =
    typeof req.headers.host === "string" && req.headers.host.trim()
      ? req.headers.host.trim()
      : "127.0.0.1";
  const search = req.url?.includes("?")
    ? req.url.slice(req.url.indexOf("?"))
    : "";
  const url = `http://${host}${pathname}${search}`;
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const body = await readBodyBuffer(req);
    if (body.length) init.body = body;
  }
  return new Request(url, init);
}

async function writeFetchResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, {
    ...headers,
    "content-length": buf.byteLength,
  });
  res.end(buf);
}

export interface CordisConnectionBridgeOptions {
  readonly http: CordisHttpRow[];
  /** When true, further fetch.register late-binds onto the live registry. */
  isSealed: () => boolean;
  onLateMiss?: (path: string) => void;
}

/** Build a DSH-shaped `connection` service for Cordis `ctx.provide("connection")`. */
export function createCordisConnectionBridge(
  options: CordisConnectionBridgeOptions,
): {
  admit: (req: IncomingMessage) => undefined;
  requestRejection: (req: IncomingMessage) => undefined;
  fetch: { register: (route: CordisFetchRoute) => () => undefined };
} {
  return {
    admit(_req: IncomingMessage) {
      return undefined;
    },
    requestRejection(_req: IncomingMessage) {
      return undefined;
    },
    fetch: {
      register(route: CordisFetchRoute) {
        const methods = route.methods?.map((m) => m.toUpperCase());
        const match = matchWebServerRoute({
          path: route.path,
          kind: "exact",
        });
        const row: CordisHttpRow = {
          match,
          handle: async (req, res, pathname) => {
            const method = (req.method ?? "GET").toUpperCase();
            if (methods?.length && !methods.includes(method)) {
              // Exact path is owned by this Fetch route (e.g. channel-pack
              // POST-only). Returning false let GET hit incomplete catch-all.
              res.writeHead(405, {
                allow: methods.join(", "),
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              });
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "method not allowed",
                  allow: methods,
                }),
              );
              return true;
            }
            const request = await incomingToFetchRequest(req, pathname);
            const response = await route.fetch(request);
            await writeFetchResponse(res, response);
            return true;
          },
        };
        options.http.push(row);
        if (options.isSealed()) {
          if (!registerDshCompatHttpLate(row.match, row.handle)) {
            options.onLateMiss?.(route.path);
          }
        }
        return () => undefined;
      },
    },
  };
}
