import { lookup } from "node:dns/promises";
import { WebError } from "./types.js";
import type { OutboundAllowlist } from "./outbound-allowlist.js";

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

/** True when hostname is already an IPv4 / IPv6 literal (no DNS needed). */
export function isIpLiteralHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)) return true;
  // Loose IPv6: contains ':' after stripping brackets.
  return host.includes(":");
}

export function assertHttpUrl(
  raw: string,
  maxUrlLength: number,
  options?: {
    /** Default true. Set false when an {@link OutboundAllowlist} already gates private hosts. */
    readonly checkPrivate?: boolean;
    readonly allowlist?: OutboundAllowlist;
  },
): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new WebError("url must be a non-empty string", "WEB_INVALID_URL");
  }
  if (trimmed.length > maxUrlLength) {
    throw new WebError(
      `url exceeds ${maxUrlLength} characters`,
      "WEB_INVALID_URL",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebError("url is not a valid absolute URL", "WEB_INVALID_URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebError("url must be http or https", "WEB_INVALID_URL");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new WebError("url must not include credentials", "WEB_INVALID_URL");
  }
  if (options?.allowlist) {
    options.allowlist.assertAllowed(parsed);
  } else if (options?.checkPrivate !== false && isBlockedHost(parsed.hostname)) {
    throw new WebError(
      "url targets a loopback or private-network host",
      "WEB_BLOCKED_HOST",
    );
  }
  return parsed;
}

export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * Literal loopback / RFC1918 / link-local.
 * Pair with {@link assertResolvedAddressesPublic} so DNS that resolves to a
 * private IP cannot bypass the hostname-literal check (rebinding).
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.startsWith("::ffff:")) return isBlockedHost(host.slice(7));
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (host.startsWith("fe80:")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) {
    if (host.includes(":")) return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const oct = ipv4.slice(1).map(Number) as [number, number, number, number];
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Resolve `url.hostname` and deny when any address is private / loopback.
 * No-op for IP literals (already gated by {@link assertHttpUrl} /
 * {@link isBlockedHost}). Fail-closed on DNS errors.
 */
export async function assertResolvedAddressesPublic(
  url: URL,
  options?: {
    readonly checkPrivate?: boolean;
    /** Injected lookup for tests. */
    readonly lookup?: typeof lookup;
  },
): Promise<void> {
  if (options?.checkPrivate === false) return;
  const host = url.hostname;
  if (isIpLiteralHostname(host)) return;
  const resolve = options?.lookup ?? lookup;
  let addrs: readonly { readonly address: string; readonly family: number }[];
  try {
    addrs = await resolve(host, { all: true, verbatim: true });
  } catch (err) {
    throw new WebError(
      err instanceof Error
        ? `DNS lookup failed for ${host}: ${err.message}`
        : `DNS lookup failed for ${host}`,
      "WEB_PROVIDER_ERROR",
    );
  }
  if (addrs.length === 0) {
    throw new WebError(
      `DNS lookup for ${host} returned no addresses`,
      "WEB_PROVIDER_ERROR",
    );
  }
  for (const row of addrs) {
    if (isBlockedHost(row.address)) {
      throw new WebError(
        `url resolves to a loopback or private-network address (${row.address})`,
        "WEB_BLOCKED_HOST",
      );
    }
  }
}

export function mergeTimeout(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WebError("timeoutMs must be positive", "WEB_INVALID_CONFIG");
  }
  if (timeoutMs > MAX_NODE_TIMER_DELAY_MS) {
    throw new WebError("timeoutMs is too large", "WEB_INVALID_CONFIG");
  }
  const timed = AbortSignal.timeout(timeoutMs);
  if (!outer) return timed;
  return AbortSignal.any([outer, timed]);
}
