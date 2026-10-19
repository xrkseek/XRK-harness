/**
 * 本机回环判定：产品壳同源 fetch/WS 不带 Authorization。
 */

import { timingSafeEqual } from "node:crypto";

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost"
  );
}

/**
 * Constant-time string equality for API keys / tokens.
 * Length mismatch returns false without throwing (unlike raw timingSafeEqual).
 */
export function timingSafeStringEqual(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
