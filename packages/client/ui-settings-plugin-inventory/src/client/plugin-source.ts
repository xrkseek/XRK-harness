/**
 * Client-side install-origin helpers (mirrors Face classifyManagedPluginSource).
 * Keep lightweight — no Node path APIs.
 */

export type PluginSourceClass = 'engine' | 'local' | 'registry' | 'vcs'

/** Phone guest engine rows written by PhoneGuest (`source: "phone-guest"`). */
export function isPhoneGuestEngineEntry(entry: {
  readonly entryId: string
  readonly source?: string
}): boolean {
  const s = entry.source?.trim().toLowerCase()
  if (s === 'phone-guest') return true
  const id = entry.entryId.trim()
  return id === 'xrk-mobile' || id.startsWith('xrk-mobile-')
}

/** Classify inventory source for update menu / local badge. */
export function classifyPluginSource(entry: {
  readonly entryId: string
  readonly source?: string
}): PluginSourceClass {
  if (isPhoneGuestEngineEntry(entry)) return 'engine'
  const s = entry.source?.trim()
  if (!s) return 'local'
  if (/^(file:|link:)/i.test(s)) return 'local'
  if (s.startsWith('.') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\')) {
    return 'local'
  }
  if (
    !s.startsWith('@')
    && !s.includes('@')
    && !/^[a-z][a-z0-9+.-]*:/i.test(s)
    && /[/\\]/.test(s)
  ) {
    return 'local'
  }
  if (/^(github:|git\+|https?:)/i.test(s)) return 'vcs'
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'vcs'
  return 'registry'
}

/** Whether Settings should offer the Update menu action. */
export function canOfferPluginUpdate(sourceClass: PluginSourceClass): boolean {
  return sourceClass === 'registry' || sourceClass === 'vcs'
}

/** Parse leading semver core (`1.2.3` from `v1.2.3-beta+meta`). */
function parseSemverCore(raw: string): number[] | undefined {
  const cleaned = raw.trim().replace(/^v/i, '')
  const core = cleaned.split(/[-+]/)[0] ?? ''
  if (!/^\d+(\.\d+)*$/.test(core)) return undefined
  return core.split('.').map((p) => Number.parseInt(p, 10))
}

/**
 * True when `latest` is strictly newer than `installed` on the numeric core.
 * Mirrors Face `isNpmVersionNewer` — used so badges clear when inventory
 * already matches `probe.latest` even if the Host probe cache is stale.
 */
export function isNpmVersionNewer(latest: string, installed: string): boolean {
  const a = parseSemverCore(latest)
  const b = parseSemverCore(installed)
  if (!a || !b) return false
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}

/**
 * Whether Settings should paint the →version update badge for a row.
 * Requires Host `updateAvailable` plus a live compare against the inventory
 * version so post-update cards do not keep a stale equal-version tag.
 */
export function shouldShowPluginUpdateBadge(options: {
  readonly updateAvailable?: boolean
  readonly latest?: string
  readonly installed?: string
}): boolean {
  if (options.updateAvailable !== true) return false
  const latest = options.latest?.trim() ?? ''
  if (!latest) return false
  const installed = options.installed?.trim() ?? ''
  if (!installed) return true
  return isNpmVersionNewer(latest, installed)
}
