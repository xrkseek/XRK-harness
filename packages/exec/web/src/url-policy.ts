import { WebError } from "./types.js";

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

export function assertHttpUrl(raw: string, maxUrlLength: number): URL {
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
  if (isBlockedHost(parsed.hostname)) {
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

/** Literal loopback / RFC1918 / link-local. Does not follow DNS to private IPs. */
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
