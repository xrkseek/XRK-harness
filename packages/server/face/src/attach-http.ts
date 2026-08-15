import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { parseFaceRpcRequest } from "./envelope.js";

export interface AttachFaceOptions {
  readonly apiKey: string;
  checkAuth(req: IncomingMessage): boolean;
}

/** DeepSeek-native + `/api/face/*` WS pathnames. */
export const FACE_WS_PATHS = [
  "/api/face/events.mux",
  "/api/face/events.host",
  "/api/events.mux",
  "/api/events.host",
] as const;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

/**
 * Resolve RPC method from pathname.
 * - `/api/face/session.prompt` (U1 prefix)
 * - `/api/session.prompt` (DeepSeek apiproxy shape — method must contain `.`
 *   so REST `/api/sessions` / `/api/chat` are never claimed)
 */
export function faceMethodFromPath(pathname: string): string | undefined {
  if (pathname.startsWith("/api/face/")) {
    if (
      pathname === "/api/face/events.mux" ||
      pathname === "/api/face/events.host"
    ) {
      return undefined;
    }
    const method = decodeURIComponent(pathname.slice("/api/face/".length));
    if (!method || method.includes("/")) return undefined;
    return method;
  }

  if (!pathname.startsWith("/api/")) return undefined;
  const rest = decodeURIComponent(pathname.slice("/api/".length));
  if (!rest || rest.includes("/")) return undefined;
  if (rest === "events.mux" || rest === "events.host") return undefined;
  // Protect REST: sessions, chat, health-adjacent — no dot in segment
  if (!rest.includes(".")) return undefined;
  return rest;
}

export function isFaceWsPath(pathname: string): boolean {
  return (FACE_WS_PATHS as readonly string[]).includes(pathname);
}

/**
 * If path is a Face unary route, owns the response and returns true.
 */
export function tryHandleFaceHttp(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = faceMethodFromPath(url.pathname);
  if (method === undefined) return false;

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" });
    return true;
  }
  if (!options.checkAuth(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }

  void (async () => {
    try {
      const raw = await readBody(req);
      const parsed = parseFaceRpcRequest(JSON.parse(raw || "{}") as unknown);
      const response = await dispatchFaceMethod(
        runtime,
        method,
        parsed.rpcId,
        parsed.payload,
      );
      sendJson(res, 200, response);
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
}

export function attachFaceUpgrades(
  server: Server,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
): { close(): void } {
  const muxWss = new WebSocketServer({ noServer: true });
  const hostWss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!isFaceWsPath(url.pathname)) {
      return;
    }
    if (!options.checkAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const wss = url.pathname.endsWith("mux") ? muxWss : hostWss;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  server.on("upgrade", onUpgrade);

  muxWss.on("connection", (ws: WebSocket) => {
    for (const sessionId of runtime.store.list()) {
      ws.send(
        JSON.stringify({
          rpcId: newRpcId(),
          payload: {
            type: "session/subscribed",
            sessionId,
            lastSeq: runtime.seq.last(sessionId),
          },
        }),
      );
      const pending = runtime.approvals.listPending(sessionId);
      if (pending.length > 0) {
        ws.send(
          JSON.stringify({
            rpcId: newRpcId(),
            payload: {
              type: "session/approvals",
              sessionId,
              items: [...pending],
            },
          }),
        );
      }
    }
    const off = runtime.bus.subscribeMux((rpcId, frame) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ rpcId, payload: frame }));
      }
    });
    ws.on("close", off);
  });

  hostWss.on("connection", (ws: WebSocket) => {
    const off = runtime.bus.subscribeHost((rpcId, frame) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ rpcId, payload: frame }));
      }
    });
    ws.on("close", off);
  });

  return {
    close() {
      server.off("upgrade", onUpgrade);
      muxWss.close();
      hostWss.close();
    },
  };
}

/** Dedicated Face-only server (tests / optional sidecar). */
export function createFaceOnlyServer(
  runtime: FaceRuntime,
  options: AttachFaceOptions & { host?: string; port?: number },
): {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  readonly server: Server;
} {
  const server = createServer((req, res) => {
    if (tryHandleFaceHttp(req, res, runtime, options)) return;
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  const upgrades = attachFaceUpgrades(server, runtime, options);
  return {
    server,
    async listen() {
      const host = options.host ?? "127.0.0.1";
      const port = options.port ?? 0;
      await new Promise<void>((resolve) => {
        server.listen(port, host, () => resolve());
      });
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("face: failed to bind");
      }
      return { host, port: addr.port };
    },
    async close() {
      upgrades.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** @deprecated use tryHandleFaceHttp + attachFaceUpgrades */
export function attachFaceToServer(
  server: Server,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
): { close(): void } {
  server.on("request", (req, res) => {
    tryHandleFaceHttp(req, res, runtime, options);
  });
  return attachFaceUpgrades(server, runtime, options);
}

export async function handleFaceHttpRequest(
  runtime: FaceRuntime,
  method: string,
  body: unknown,
): Promise<unknown> {
  const parsed = parseFaceRpcRequest(body);
  return dispatchFaceMethod(runtime, method, parsed.rpcId, parsed.payload);
}

function newRpcId(): string {
  return `rpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
