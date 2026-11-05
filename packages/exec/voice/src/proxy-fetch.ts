/**
 * Build a `fetch` that tunnels HTTPS through an operator HTTP CONNECT proxy.
 * Used by Edge voice catalog + OpenAI-compatible TTS/ASR when the Host cannot
 * reach the origin directly (phone hotspot / filtered LAN).
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { parseProxy } from "./download-http.js";

/**
 * Create a fetch implementation that always uses `proxyUrl`.
 * @param proxyUrl - Operator setting (`http://127.0.0.1:7897`).
 * @returns A fetch bound to that proxy, or throws when the URL is unusable.
 */
export function createProxiedFetch(proxyUrl: string): typeof fetch {
  const parsed = parseProxy(proxyUrl);
  if (parsed.error !== undefined) {
    throw new Error(`tts proxy is unusable (${proxyUrl}): ${parsed.error}`);
  }
  if (parsed.target === undefined) {
    throw new Error(`tts proxy is empty (${proxyUrl})`);
  }
  // Rebuild a canonical URL undici accepts (scheme + host + port).
  const dispatcher = new ProxyAgent(
    `http://${parsed.target.host}:${parsed.target.port}`,
  );
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher,
    })) as typeof fetch;
}

/**
 * Resolve a fetch for cloud voice: proxied when `proxy` is set, else default.
 * Empty / whitespace proxy means direct.
 */
export function resolveVoiceFetch(options: {
  readonly proxy?: string;
  readonly fetchImpl?: typeof fetch;
}): typeof fetch {
  if (options.fetchImpl) return options.fetchImpl;
  const proxy = options.proxy?.trim();
  if (!proxy) return fetch;
  return createProxiedFetch(proxy);
}
