/**
 * HTTP CONNECT agent for `ws` WebSockets (Edge TTS).
 * Node's `ws` accepts a classic `http.Agent`; undici's ProxyAgent does not plug
 * in, so we tunnel with the same CONNECT shape as download-http.
 */

import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import type { Duplex } from "node:stream";
import { parseProxy, type ProxyTarget } from "./download-http.js";

const CONNECT_TIMEOUT_MS = 8_000;

/**
 * Build an `http.Agent` that opens TLS sockets through an HTTP CONNECT proxy.
 * @param proxyUrl - Operator setting (`http://127.0.0.1:7897`).
 * @returns Agent for `new WebSocket(url, { agent })`, or throws if unusable.
 */
export function createWsProxyAgent(proxyUrl: string): http.Agent {
  const parsed = parseProxy(proxyUrl);
  if (parsed.error !== undefined || parsed.target === undefined) {
    throw new Error(
      `tts proxy is unusable (${proxyUrl}): ${parsed.error ?? "empty"}`,
    );
  }
  return new ConnectProxyAgent(parsed.target);
}

class ConnectProxyAgent extends http.Agent {
  constructor(private readonly proxy: ProxyTarget) {
    super({ keepAlive: true });
  }

  // `ws` calls createConnection with { host, port, ... } for wss targets.
  override createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | undefined {
    const destHost = String(options.host ?? options.hostname ?? "");
    const destPort = Number(options.port ?? 443);
    const done =
      callback ??
      ((_err: Error | null, _stream?: Duplex) => {
        /* no-op */
      });

    const req = http.request({
      host: this.proxy.host,
      port: this.proxy.port,
      method: "CONNECT",
      path: `${destHost}:${destPort}`,
      timeout: CONNECT_TIMEOUT_MS,
    });

    const fail = (err: Error): void => {
      const placeholder = new net.Socket();
      placeholder.destroy();
      done(err, placeholder);
    };

    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(
          new Error(
            `proxy refused CONNECT ${destHost}:${destPort} → HTTP ${res.statusCode}`,
          ),
        );
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        host: destHost,
        servername: destHost,
      });
      tlsSocket.once("secureConnect", () => {
        done(null, tlsSocket);
      });
      tlsSocket.once("error", (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    });
    req.once("error", (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });
    req.once("timeout", () => {
      req.destroy(new Error("proxy connect timeout"));
    });
    req.end();

    // Agent contract: real socket arrives via callback.
    return new net.Socket();
  }
}
