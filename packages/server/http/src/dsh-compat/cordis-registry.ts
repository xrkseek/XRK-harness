/**
 * Generic Cordis-style RPC channel dispatcher.
 * Plugins register handlers by channel prefix; Host mounts one public entry.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, rpcErr, rpcOk, sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { trySettingsFallbackRpc } from "./cordis-settings-fallback.js";

export type CordisRpcHandler = (
  endpoint: string,
  payload: Record<string, unknown>,
  req?: IncomingMessage,
) => unknown | Promise<unknown>;

export type CordisHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
) => boolean | Promise<boolean>;

export interface CordisCompatRegistry {
  registerRpc(channel: string, handler: CordisRpcHandler): void;
  registerHttp(match: (pathname: string) => boolean, handler: CordisHttpHandler): void;
  invokeRpc(
    channel: string,
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  listRpcChannels(): readonly string[];
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean>;
}

function normalizeRpcChannel(channel: string): string {
  return channel.endsWith("/") ? channel.slice(0, -1) : channel;
}

export function createCordisCompatRegistry(): CordisCompatRegistry {
  const rpc = new Map<string, CordisRpcHandler>();
  const http: Array<{
    match: (pathname: string) => boolean;
    handler: CordisHttpHandler;
  }> = [];

  return {
    registerRpc(channel, handler) {
      rpc.set(normalizeRpcChannel(channel), handler);
    },
    registerHttp(match, handler) {
      http.push({ match, handler });
    },
    async invokeRpc(channel, endpoint, payload) {
      const key = normalizeRpcChannel(channel);
      const handler = rpc.get(key);
      if (!handler) {
        throw new Error(`unknown rpc channel: ${key}`);
      }
      return handler(endpoint, payload);
    },
    listRpcChannels() {
      return [...rpc.keys()];
    },
    async handle(req, res, pathname) {
      for (const row of http) {
        if (!row.match(pathname)) continue;
        if (await row.handler(req, res, pathname)) return true;
      }

      for (const [channel, handler] of rpc) {
        if (pathname !== channel && !pathname.startsWith(`${channel}/`)) {
          continue;
        }
        if ((req.method ?? "GET").toUpperCase() !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return true;
        }
        const endpoint =
          pathname.slice(channel.length).replace(/^\//, "") || "";
        const raw = await readBody(req);
        let rpcId = "unknown";
        let payload: Record<string, unknown> = {};
        let method = endpoint;
        try {
          const msg = JSON.parse(raw || "{}") as {
            rpcId?: string;
            method?: string;
            payload?: Record<string, unknown>;
          };
          if (typeof msg.rpcId === "string") rpcId = msg.rpcId;
          if (typeof msg.method === "string" && msg.method) method = msg.method;
          if (msg.payload && typeof msg.payload === "object") {
            payload = msg.payload;
          } else if (msg && typeof msg === "object") {
            // Some clients POST the payload object itself (sidebar-style).
            const { type: _t, rpcId: _id, method: _m, payload: _p, ...rest } =
              msg as Record<string, unknown>;
            if (Object.keys(rest).length > 0) payload = rest;
          }
        } catch {
          sendJson(res, 400, rpcErr(rpcId, "bad-request", "invalid JSON body"));
          return true;
        }
        try {
          const value = await handler(method || endpoint, payload, req);
          sendJson(res, 200, rpcOk(rpcId, value));
        } catch (err) {
          sendJson(
            res,
            200,
            rpcErr(
              rpcId,
              "handler-failure",
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
        return true;
      }

      // Unmatched Cordis-style POST: settings channel fallback, then generic envelope.
      if (
        (req.method ?? "GET").toUpperCase() === "POST" &&
        !pathname.startsWith("/api") &&
        /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9_$./-]*)?$/.test(pathname)
      ) {
        const raw = await readBody(req);
        let rpcId = "unknown";
        let payload: Record<string, unknown> = {};
        let method = "";
        try {
          const msg = JSON.parse(raw || "{}") as {
            rpcId?: string;
            method?: string;
            payload?: Record<string, unknown>;
          };
          if (typeof msg.rpcId === "string") rpcId = msg.rpcId;
          if (typeof msg.method === "string") method = msg.method;
          if (msg.payload && typeof msg.payload === "object") {
            payload = msg.payload;
          }
        } catch {
          /* ignore */
        }
        const slash = pathname.indexOf("/", 1);
        const endpoint =
          slash > 0
            ? pathname.slice(slash + 1).replace(/^\//, "")
            : method || "";
        const fallback = trySettingsFallbackRpc(pathname, endpoint, payload);
        if (fallback !== undefined) {
          sendJson(res, 200, rpcOk(rpcId, fallback));
          return true;
        }
        sendJson(
          res,
          200,
          rpcOk(rpcId, {
            adapter: DSH_COMPAT_ADAPTER,
            path: pathname,
            ok: true,
            status: "ready",
            writable: true,
            value: {},
          }),
        );
        return true;
      }

      return false;
    },
  };
}
