/**
 * Browser-safe privilege helpers. Two Host planes stay distinct:
 *
 * - **local** — loopback / Desktop (`ownsHost` · `xrk-app:`) / private LAN IP.
 *   No PIN; same machine or intentional bind. Never granted by cookies.
 * - **operator-pin** — after Host set HttpOnly PIN / device session; SPA sees
 *   `xrk_operator_ui` + `sessionStorage` as a *UX hint only*. Forging those
 *   markers does not authenticate Host Face / Cordis privileged methods.
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

/** sessionStorage key written by gate pages / SPA after operator unlock. */
export const OPERATOR_ACCESS_STORAGE_KEY = 'xrk.operatorAccess'

/**
 * Non-HttpOnly twin of Host PIN / device-session cookies (server
 * `OPERATOR_UI_COOKIE`). Cookie-return visits never re-run gate page scripts,
 * so the SPA elevates UX from this marker on boot. Not a Host credential.
 */
export const OPERATOR_UI_COOKIE = 'xrk_operator_ui'

/** Client access plane — local Host vs PIN-elevated remote vs locked remote. */
export type ClientAccessPlane = 'local' | 'operator-pin' | 'remote'

function hasOperatorAccessFlag(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false
    return sessionStorage.getItem(OPERATOR_ACCESS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function cookieHasOperatorUiMarker(cookieSource: string | undefined): boolean {
  return (cookieSource ?? '')
    .split(';')
    .some((part) => part.trim() === `${OPERATOR_UI_COOKIE}=1`)
}

/**
 * Elevate the operator sessionStorage UX flag (PIN / pair / renew / SPA sync).
 * Never demotes. Does not authenticate the Host — Face still requires HttpOnly PIN.
 * @returns whether the flag is set after the call.
 */
export function elevateOperatorAccess(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false
    sessionStorage.setItem(OPERATOR_ACCESS_STORAGE_KEY, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Copy Host `xrk_operator_ui` into sessionStorage when present (UX only).
 * Elevate-only: a missing cookie must not wipe a flag set by the PIN/login script.
 * @param cookieSource - `document.cookie`, or an explicit string in tests.
 * @returns whether the UI cookie was present.
 */
export function syncOperatorAccessFromUiCookie(
  cookieSource: string | undefined = typeof document !== 'undefined'
    ? document.cookie
    : undefined,
): boolean {
  if (!cookieHasOperatorUiMarker(cookieSource)) return false
  elevateOperatorAccess()
  return true
}

/**
 * Geometry / Desktop only — never PIN cookies or sessionStorage.
 * 127 · Desktop ownsHost · xrk-app · private LAN IP · non-browser.
 */
export function isLocalHostSurface(options: {
  readonly ownsHost?: boolean
  readonly pageLocation?: { readonly hostname: string; readonly protocol?: string }
}): boolean {
  if (options.ownsHost === true) return true
  const page = options.pageLocation
  if (page === undefined) return true
  if (isLoopbackHostname(page.hostname)) return true
  if (isPrivateLanHostname(page.hostname)) return true
  if (page.protocol === 'xrk-app:') return true
  return false
}

/**
 * Whether Settings / native-open UX may use Host-backed scopes.
 * local plane OR operator-pin UX marker (after real Host PIN set the UI cookie).
 */
export function isPrivilegedClientSurface(options: {
  readonly ownsHost?: boolean
  readonly pageLocation?: { readonly hostname: string; readonly protocol?: string }
}): boolean {
  if (isLocalHostSurface(options)) return true
  return hasOperatorAccessFlag()
}

/**
 * Resolve the client access plane (sync UI cookie first for PIN returns).
 */
export function resolveClientAccessPlane(options: {
  readonly ownsHost?: boolean
  readonly pageLocation?: { readonly hostname: string; readonly protocol?: string }
  readonly cookieSource?: string
}): ClientAccessPlane {
  if (isLocalHostSurface(options)) return 'local'
  syncOperatorAccessFromUiCookie(options.cookieSource)
  if (hasOperatorAccessFlag()) return 'operator-pin'
  return 'remote'
}

/**
 * Boot-time privilege resolve for SettingsScope bind: sync UI cookie, then
 * evaluate. Prefer over a one-shot {@link isPrivilegedClientSurface}.
 */
export function resolvePrivilegedClientSurface(options: {
  readonly ownsHost?: boolean
  readonly pageLocation?: { readonly hostname: string; readonly protocol?: string }
  readonly cookieSource?: string
}): boolean {
  return resolveClientAccessPlane(options) !== 'remote'
}
