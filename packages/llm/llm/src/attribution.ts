/**
 * Product identity on every provider HTTP request (`User-Agent`).
 * Mirrors DSH `attributionHeaders`: callers may set other headers, but cannot
 * suppress identity. OpenCode Go docs require a coding-agent UA (not a generic
 * SDK / undici default).
 */

import { createRequire } from "node:module";

const version = (() => {
  const req = createRequire(import.meta.url);
  for (const rel of ["../package.json", "../../package.json"] as const) {
    try {
      return (req(rel) as { version: string }).version;
    } catch {
      /* try next candidate */
    }
  }
  return "0.0.0";
})();

export interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  readonly product: string;
  /** Product version from package metadata. */
  readonly version: string;
  /** Repo URL used as the `User-Agent` comment. */
  readonly url: string;
}

/** Default XRK Harness identity (public facts only — no secrets / session ids). */
export const APP_IDENTITY: AppIdentity = {
  product: "xrk-harness",
  version,
  url: "https://github.com/xrkseek/XRK-harness",
};

/** `product/version (+url)` — RFC 9110 product + comment form. */
export function userAgent(identity: AppIdentity = APP_IDENTITY): string {
  return `${identity.product}/${identity.version} (+${identity.url})`;
}

/** Headers every adapter must send; currently just `user-agent`. */
export function attributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { "user-agent": userAgent(identity) };
}

/**
 * Merge attribution last so a caller-supplied `User-Agent` cannot suppress
 * product identity (DSH pi-ai / wire adapters do the same).
 */
export function mergeOutboundAttributionHeaders(
  headers: Record<string, string>,
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { ...headers, ...attributionHeaders(identity) };
}
