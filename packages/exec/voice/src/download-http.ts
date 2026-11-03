/**
 * Asset download that survives a filtered network.
 *
 * Two facts measured on the failing box, both of which `fetch` ignores:
 *
 *   1. `huggingface.co` / `hf-mirror.com` answer with a 302 to
 *      `cas-bridge.xethub.hf.co`, and that CloudFront host **never completes a
 *      TLS handshake from Node** (15 s timeout, then ECONNRESET) while `curl`
 *      on the same machine pulls the same URL in 1.5 s. A local proxy fixes it
 *      — `curl -x http://127.0.0.1:7897` returns 200 in 3.6 s.
 *   2. Node's `fetch` (undici) picks one A record and gives up; `https.request`
 *      honours `autoSelectFamily`, so it already walks to a second address when
 *      the first black-holes.
 *
 * So the transport is: an HTTP CONNECT tunnel through the proxy the operator
 * configured, otherwise a name-based `https` request (never a pinned IP —
 * pinning an address bypasses proxy rules that match on hostname, which is
 * what made the first attempt fail). The proxy is a user setting, not a guess:
 * see `parseProxy`.
 *
 * Deliberately not here: SOCKS, HTTP/2, keep-alive pooling. Three files, one
 * press, one connection each (YAGNI).
 */
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** One opened asset: status plus the body, which is null for a non-2xx. */
export interface DownloadStream {
  readonly status: number;
  readonly body: AsyncIterable<Uint8Array> | null;
}

interface ProxyTarget {
  readonly host: string;
  readonly port: number;
}

const REDIRECT_LIMIT = 5;
const CONNECT_TIMEOUT_MS = 8_000;

/**
 * Parse an operator-supplied proxy URL (`http://127.0.0.1:7897`, or the bare
 * `127.0.0.1:7897` form people paste from a Clash panel).
 * @param value - Setting text; empty means 「no proxy」.
 * @returns The loopback-or-remote CONNECT endpoint, or undefined when unset.
 */
export function parseProxy(value: string | undefined): ProxyTarget | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    return { host: url.hostname, port };
  } catch {
    return undefined;
  }
}

/**
 * Open an HTTP CONNECT tunnel and wrap it in TLS for the target host.
 * @param proxy - Local CONNECT proxy.
 * @param hostname - Origin host the tunnel should reach.
 * @param port - Origin port.
 * @param signal - Caller cancellation.
 * @returns A TLS socket already speaking to the origin.
 */
async function tunnel(
  proxy: ProxyTarget,
  hostname: string,
  port: number,
  signal: AbortSignal,
): Promise<tls.TLSSocket> {
  const socket = net.connect({ host: proxy.host, port: proxy.port });
  const onAbort = (): void => {
    socket.destroy();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error("proxy connect timeout")));
    await once(socket, "connect");
    socket.write(`CONNECT ${hostname}:${port} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n\r\n`);
    const [head] = (await once(socket, "data")) as [Buffer];
    const statusLine = head.toString("latin1").split("\r\n")[0] ?? "";
    if (!/^HTTP\/1\.[01] 2\d\d/.test(statusLine)) {
      throw new Error(`proxy refused CONNECT: ${statusLine}`);
    }
    socket.setTimeout(0);
    const secured = tls.connect({ socket, servername: hostname });
    await once(secured, "secureConnect");
    return secured;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Issue one GET over an established socket.
 * @param url - Absolute https URL.
 * @param socket - Connected TLS socket (tunnelled or direct).
 * @param signal - Caller cancellation.
 * @returns The response with headers already parsed.
 */
function requestOn(
  url: URL,
  socket: tls.TLSSocket,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: url.hostname,
        port: url.port === "" ? 443 : Number(url.port),
        servername: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.hostname, "accept-encoding": "identity" },
        createConnection: () => socket,
        signal,
      },
      resolve,
    );
    request.once("error", reject);
    request.end();
  });
}

/**
 * Issue one GET letting Node own the connection (and `autoSelectFamily` own
 * address failover).
 * @param url - Absolute https URL.
 * @param signal - Caller cancellation.
 * @returns The response with headers already parsed.
 */
function requestDirect(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: url.hostname,
        port: url.port === "" ? 443 : Number(url.port),
        servername: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.hostname, "accept-encoding": "identity" },
        signal,
      },
      resolve,
    );
    request.once("error", reject);
    request.end();
  });
}

/**
 * Follow redirects, opening each hop through the same transport.
 * @param rawUrl - Absolute asset URL.
 * @param proxy - Proxy to tunnel through, or undefined for a direct request.
 * @param signal - Caller cancellation.
 * @returns Status plus the body stream; non-2xx is reported, never thrown.
 */
async function openFollow(
  rawUrl: string,
  proxy: ProxyTarget | undefined,
  signal: AbortSignal,
): Promise<DownloadStream> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= REDIRECT_LIMIT; hop += 1) {
    const port = current.port === "" ? 443 : Number(current.port);
    const response =
      proxy === undefined
        ? await requestDirect(current, signal)
        : await requestOn(current, await tunnel(proxy, current.hostname, port, signal), signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && typeof location === "string") {
      response.resume();
      current = new URL(location, current);
      continue;
    }
    return { status, body: status >= 200 && status < 300 ? response : null };
  }
  return { status: 0, body: null };
}

/**
 * Open one asset URL, preferring a local proxy and falling back to a direct
 * request when the proxy cannot carry the hop.
 * @param rawUrl - Absolute asset URL.
 * @param signal - Caller cancellation (no header deadline of its own).
 * @param proxyUrl - Operator-configured proxy, if any.
 * @returns Status plus a byte stream.
 */
export async function openAssetStream(
  rawUrl: string,
  signal: AbortSignal,
  proxyUrl?: string,
): Promise<DownloadStream> {
  // Explicit setting first, then the product's own env override. Never a
  // guessed port: a Host must not route a user's traffic through a relay
  // they did not name.
  const proxy = parseProxy(proxyUrl) ?? parseProxy(process.env.XRK_DOWNLOAD_PROXY);
  if (proxy === undefined) return openFollow(rawUrl, undefined, signal);
  try {
    return await openFollow(rawUrl, proxy, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // A proxy that cannot carry this hop must not fail the download when the
    // direct route might work: fall through and try it.
    return openFollow(rawUrl, undefined, signal);
  }
}
