/**
 * Browser-safe, zero-dependency loopback / LAN classification shared by the
 * `/api` Host fence and the package's `ctx.connection` state. The predicate
 * stays package-internal; client plugins consume the derived state through Cordis.
 */

/**
 * Whether a normalized URL hostname names the local loopback authority.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * RFC1918 + link-local IPv4 literals (intentional `serve --host 10.x` / 192.168.x).
 * Not a DNS name — only dotted quads so `trustedHosts` DNS entries stay non-privileged.
 */
export function isPrivateLanHostname(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  if (!parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

/** sessionStorage key set by the WAN/LAN PIN page after a successful unlock. */
export const OPERATOR_ACCESS_STORAGE_KEY = 'xrk.operatorAccess'

function hasOperatorAccessFlag(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false
    return sessionStorage.getItem(OPERATOR_ACCESS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Whether the page may use Host-local capabilities (settings / credentials UI,
 * `canOpenPath` gates, mid-turn Boss 插话). Desktop: `__XRK_TRANSPORT__.ownsHost`
 * or `xrk-app:`; else loopback, private LAN IP (same-origin page from an
 * intentional LAN bind), PIN-elevated operator, or non-browser.
 */
export function isPrivilegedClientSurface(options: {
  readonly ownsHost?: boolean
  readonly pageLocation?: { readonly hostname: string; readonly protocol?: string }
}): boolean {
  if (options.ownsHost === true) return true
  const page = options.pageLocation
  if (page === undefined) return true
  if (isLoopbackHostname(page.hostname)) return true
  if (isPrivateLanHostname(page.hostname)) return true
  if (page.protocol === 'xrk-app:') return true
  return hasOperatorAccessFlag()
}
