/** Browser-safe UUID generation for wire correlation. */

/**
 * Mint an RFC 4122 version 4 UUID.
 *
 * Prefer native `crypto.randomUUID()` (HTTPS, localhost, Node). On plain HTTP LAN
 * hosts the Web API omits `randomUUID` even though `getRandomValues` stays
 * available — the fallback uses the same CSPRNG source and sets version/variant
 * bits identically to the native implementation.
 */
export function randomUuid(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  if (cryptoObj === undefined || typeof cryptoObj.getRandomValues !== 'function') {
    throw new TypeError('randomUuid: crypto.getRandomValues is unavailable')
  }
  const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
