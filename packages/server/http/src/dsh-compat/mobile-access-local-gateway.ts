/**
 * Loopback reverse proxy — remote tunnel backends forward to the product Host.
 * Forwards HTTP and WebSocket upgrades with X-Forwarded-* headers.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";

export interface LocalMobileGateway {
  readonly address: () => { host: string; port: number; origin?: string };
  readonly extensionStatus: () => { loaded: number; failed: number };
  readonly close: () => Promise<void>;
}

function upstreamPort(upstream: URL): number {
  if (upstream.port) return Number(upstream.port);
  return upstream.protocol === "https:" ? 443 : 80;
}

function clientProto(req: IncomingMessage, publicOrigin?: string): string {
  const forwarded = req.headers["x-forwarded-proto"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  if (publicOrigin) {
    try {
      return new URL(publicOrigin).protocol.replace(/:$/, "");
    } catch {
      /* ignore */
    }
  }
  return "http";
}

function buildProxyHeaders(
  req: IncomingMessage,
  upstream: URL,
  publicOrigin?: string,
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: upstream.host,
  };
  const clientHost =
    publicOrigin !== undefined
      ? (() => {
          try {
            return new URL(publicOrigin).host;
          } catch {
            return req.headers.host?.trim();
          }
        })()
      : req.headers.host?.trim();
  if (clientHost) {
    headers["x-forwarded-host"] = clientHost;
  }
  headers["x-forwarded-proto"] = clientProto(req, publicOrigin);
  const remote = req.socket.remoteAddress;
  if (remote) {
    const prior = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = prior
      ? `${String(prior)}, ${remote}`
      : remote;
  }
  return headers;
}

function writeUpgradeResponse(
  socket: Socket,
  statusCode: number,
  statusMessage: string,
  rawHeaders: IncomingMessage["headers"],
  head: Buffer,
): void {
  let raw = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      raw += `${key}: ${entry}\r\n`;
    }
  }
  raw += "\r\n";
  socket.write(raw);
  if (head.length > 0) socket.write(head);
}

function forwardUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  upstream: URL,
  publicOrigin?: string,
): void {
  socket.on("error", () => socket.destroy());
  const targetPath =
    req.url?.startsWith("/") ? req.url : `/${req.url ?? ""}`;
  const proxyReq = httpRequest({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstreamPort(upstream),
    method: req.method,
    path: targetPath,
    headers: buildProxyHeaders(req, upstream, publicOrigin),
  });
  proxyReq.on("response", (proxyRes) => {
    if (!socket.destroyed) {
      socket.destroy();
    }
    proxyRes.resume();
  });
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    writeUpgradeResponse(
      socket,
      proxyRes.statusCode ?? 101,
      proxyRes.statusMessage ?? "Switching Protocols",
      proxyRes.headers,
      proxyHead,
    );
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => {
      socket.destroy();
      proxySocket.destroy();
    });
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end(head);
}

export async function startLocalProxyGateway(options: {
  readonly upstreamUrl: string;
  readonly listenPort?: number;
  readonly publicOrigin?: string;
}): Promise<LocalMobileGateway> {
  const upstream = new URL(options.upstreamUrl);
  let listenPort = options.listenPort ?? 0;
  const publicOrigin = options.publicOrigin;

  const proxy = (clientReq: IncomingMessage, clientRes: ServerResponse) => {
    const targetPath =
      clientReq.url?.startsWith("/")
        ? clientReq.url
        : `/${clientReq.url ?? ""}`;
    const proxyReq = httpRequest(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstreamPort(upstream),
        method: clientReq.method,
        path: targetPath,
        headers: buildProxyHeaders(clientReq, upstream, publicOrigin),
      },
      (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(clientRes);
      },
    );
    proxyReq.on("error", () => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "content-type": "text/plain" });
        clientRes.end("upstream unreachable");
      } else {
        clientRes.end();
      }
    });
    clientReq.pipe(proxyReq);
  };

  const server = createServer(proxy);
  server.on("upgrade", (req, socket, head) => {
    forwardUpgrade(req, socket as Socket, head, upstream, publicOrigin);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("gateway_listen_failed");
  }
  listenPort = addr.port;

  return {
    address: () => ({
      host: "127.0.0.1",
      port: listenPort,
      ...(publicOrigin ? { origin: publicOrigin } : {}),
    }),
    extensionStatus: () => ({ loaded: 0, failed: 0 }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function reserveLoopbackPort(): Promise<{
  port: number;
  release: () => Promise<void>;
}> {
  const holder = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.listen(0, "127.0.0.1", () => {
      holder.off("error", reject);
      resolve();
    });
  });
  const addr = holder.address();
  if (!addr || typeof addr === "string") {
    holder.close();
    throw new Error("port_reservation_failed");
  }
  let released = false;
  return {
    port: addr.port,
    release: async () => {
      if (released) return;
      released = true;
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    },
  };
}
