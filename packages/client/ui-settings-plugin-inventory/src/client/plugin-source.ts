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
