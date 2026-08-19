/**
 * Face HTTP unary + mux/host WebSocket 挂载。
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { listPendingAdmits } from "@xrkseek/core-session";
import { WebSocketServer, type WebSocket } from "ws";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { approvalRequestedFrame } from "./approvals.js";
import { questionRequestedFrame } from "./questions.js";
import { toQueueItems } from "./queue.js";
import {
  FACE_WS_PATHS,
  faceMethodFromPath,
  isFaceRespondPath,
  isFaceWsPath,
  parseFaceRpcRequest,
  readHttpBody,
  sendJson,
  serverRequestFrame,
  settleFaceRespond,
} from "./wire/index.js";
import {
  buildSessionExportZip,
  isSessionExportPath,
  sessionExportFilename,
} from "./session-export.js";

export interface AttachFaceOptions {
  readonly apiKey: string;
  checkAuth(req: IncomingMessage): boolean;
}

export { FACE_WS_PATHS, faceMethodFromPath, isFaceWsPath };

/**
 * 若路径是 Face unary 或 `/api/respond`，接管响应并返回 true。
 */
export function tryHandleFaceHttp(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (isFaceRespondPath(url.pathname)) {
    return handleFaceRespond(req, res, runtime, options);
  }
  if (isSessionExportPath(url.pathname)) {
    return handleSessionExport(req, res, runtime, options, url);
  }

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
      const raw = await readHttpBody(req);
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

function handleSessionExport(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
  url: URL,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method not allowed" });
    return true;
  }
  if (!options.checkAuth(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    sendJson(res, 400, { error: "sessionId required" });
    return true;
  }
  if (!runtime.store.has(sessionId)) {
    sendJson(res, 404, { error: "session not found" });
    return true;
  }
  const includeDescendants = url.searchParams.get("includeDescendants") !== "false";
  const filename = sessionExportFilename(sessionId);
  const headers = {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return true;
  }
  void (async () => {
    try {
      const zip = await buildSessionExportZip(
        runtime,
        sessionId,
        includeDescendants,
      );
      res.writeHead(200, {
        ...headers,
        "content-length": zip.length,
      });
      res.end(zip);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
}

function handleFaceRespond(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FaceRuntime,
  options: AttachFaceOptions,
): boolean {
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
      const raw = await readHttpBody(req);
      const body = JSON.parse(raw || "{}") as unknown;
      sendJson(res, 200, settleFaceRespond(runtime, body));
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
        JSON.stringify(
          serverRequestFrame(newRpcId(), {
            type: "session/subscribed",
            sessionId,
            lastSeq: runtime.seq.last(sessionId),
          }),
        ),
      );
      const pendingAdmits = listPendingAdmits(
        runtime.store.get(sessionId).events,
        sessionId,
      );
      if (pendingAdmits.length > 0) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(newRpcId(), {
              type: "session/queue",
              sessionId,
              items: toQueueItems(pendingAdmits, runtime.admitRpcMap),
            }),
          ),
        );
      }
      for (const item of runtime.approvals.listPending(sessionId)) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(item.rpcId, approvalRequestedFrame(item)),
          ),
        );
      }
      for (const item of runtime.questions.listPending(sessionId)) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(item.rpcId, questionRequestedFrame(item)),
          ),
        );
      }
      const jobViews = runtime.jobViewsFor(sessionId);
      if (jobViews && jobViews.length > 0) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(newRpcId(), {
              type: "session/jobs",
              sessionId,
              jobs: jobViews,
            }),
          ),
        );
      }
      const snap = runtime.projections.snapshot(sessionId);
      for (const [key, value] of Object.entries(snap.values)) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(newRpcId(), {
              type: "session/projection",
              sessionId,
              key,
              value,
              seq: snap.asOfSeq < 0 ? 0 : snap.asOfSeq,
            }),
          ),
        );
      }
    }
    const off = runtime.bus.subscribeMux((rpcId, frame) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(
              rpcId,
              frame,
            ),
          ),
        );
      }
    });
    ws.on("close", off);
  });

  hostWss.on("connection", (ws: WebSocket) => {
    const off = runtime.bus.subscribeHost((rpcId, frame) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify(
            serverRequestFrame(
              rpcId,
              frame,
            ),
          ),
        );
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

/** 仅 Face 的测试/边车服务器。 */
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
