/**
 * Shell keyboard-shortcut registry + device-local overrides (Hermes/DSH
 * pattern: localStorage diff-only; not Host settings.yaml — chords are
 * OS/browser-bound). Composer Enter/newline stay fixed/read-only.
 */

/** localStorage key for override-only document. */
export const SHELL_SHORTCUTS_STORAGE_KEY = 'xrk.shortcuts.v1'

/** Platform accelerator token (`mod` = ⌘ on macOS, Ctrl elsewhere). */
export type ShellShortcutId =
  | 'keybinds.openPanel'
  | 'composer.submit'
  | 'composer.newline'
  | 'layout.toggleSidebar'
  | 'layout.toggleDetails'

/** One shipped shortcut definition. */
export interface ShellShortcutDef {
  readonly id: ShellShortcutId
  /** Canonical default chord (`mod+/`, `shift+enter`, …). */
  readonly defaultCombo: string
  /** When true, display-only — not rebindable. */
  readonly fixed: boolean
  /** Locale category key under `layout`. */
  readonly categoryKey: 'shortcuts.cat.general' | 'shortcuts.cat.composer' | 'shortcuts.cat.panels'
  /** Locale label key under `layout`. */
  readonly labelKey:
    | 'shortcuts.openPanel'
    | 'shortcuts.submit'
    | 'shortcuts.newLine'
    | 'shortcuts.toggleSidebar'
    | 'shortcuts.toggleDetails'
}

/** Shipped catalog (order = panel order). */
export const SHELL_SHORTCUT_DEFS: readonly ShellShortcutDef[] = [
  {
    id: 'keybinds.openPanel',
    defaultCombo: 'mod+/',
    fixed: false,
    categoryKey: 'shortcuts.cat.general',
    labelKey: 'shortcuts.openPanel',
  },
  {
    id: 'composer.submit',
    defaultCombo: 'mod+enter',
    fixed: true,
    categoryKey: 'shortcuts.cat.composer',
    labelKey: 'shortcuts.submit',
  },
  {
    id: 'composer.newline',
    defaultCombo: 'shift+enter',
    fixed: true,
    categoryKey: 'shortcuts.cat.composer',
    labelKey: 'shortcuts.newLine',
  },
  {
    id: 'layout.toggleSidebar',
    defaultCombo: 'mod+b',
    fixed: false,
    categoryKey: 'shortcuts.cat.panels',
    labelKey: 'shortcuts.toggleSidebar',
  },
  {
    id: 'layout.toggleDetails',
    defaultCombo: 'mod+j',
    fixed: false,
    categoryKey: 'shortcuts.cat.panels',
    labelKey: 'shortcuts.toggleDetails',
  },
]

/** Override map: id → canonical combo (only diverged rows). */
export type ShellShortcutOverrides = Readonly<Partial<Record<ShellShortcutId, string>>>

/** True when the runtime looks like Apple. */
export function isApplePlatform(platform = typeof navigator !== 'undefined' ? navigator.platform : ''): boolean {
  return /Mac|iPhone|iPad/i.test(platform)
}

/** Normalize a stored or captured combo for indexing. */
export function canonicalizeCombo(combo: string, apple = isApplePlatform()): string {
  const parts = combo.trim().toLowerCase().split('+').filter(Boolean)
  const out: string[] = []
  let hasMod = false
  let hasCtrl = false
  let hasAlt = false
  let hasShift = false
  let base = ''
  for (const part of parts) {
    if (part === 'mod' || part === 'cmd' || part === 'meta' || part === 'command') {
      hasMod = true
      continue
    }
    if (part === 'ctrl' || part === 'control') {
      if (apple) hasCtrl = true
      else hasMod = true
      continue
    }
    if (part === 'alt' || part === 'option') {
      hasAlt = true
      continue
    }
    if (part === 'shift') {
      hasShift = true
      continue
    }
    base = part
  }
  if (hasMod) out.push('mod')
  if (hasCtrl) out.push('ctrl')
  if (hasAlt) out.push('alt')
  if (hasShift) out.push('shift')
  if (base !== '') out.push(base)
  return out.join('+')
}

/** Display label for a canonical combo (⌘ vs Ctrl). */
export function formatCombo(combo: string, apple = isApplePlatform()): string {
  const parts = canonicalizeCombo(combo, apple).split('+').filter(Boolean)
  const labels: string[] = []
  for (const part of parts) {
    if (part === 'mod') {
      labels.push(apple ? '⌘' : 'Ctrl')
      continue
    }
    if (part === 'ctrl') {
      labels.push('Ctrl')
      continue
    }
    if (part === 'alt') {
      labels.push(apple ? '⌥' : 'Alt')
      continue
    }
    if (part === 'shift') {
      labels.push('Shift')
      continue
    }
    if (part === 'enter') {
      labels.push('Enter')
      continue
    }
    if (part === 'escape') {
      labels.push('Esc')
      continue
    }
    if (part === 'space') {
      labels.push('Space')
      continue
    }
    if (part.length === 1) {
      labels.push(part.toUpperCase())
      continue
    }
    labels.push(part)
  }
  return labels.join('+')
}

/** Parse a KeyboardEvent into a canonical combo, or null for modifier-only / IME. */
export function comboFromEvent(event: KeyboardEvent, apple = isApplePlatform()): string | null {
  if (event.isComposing || event.key === 'Process') return null
  if (event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Shift') {
    return null
  }
  let base = ''
  if (event.key === 'Enter') base = 'enter'
  else if (event.key === 'Escape') base = 'escape'
  else if (event.key === ' ') base = 'space'
  else if (event.key === 'Tab') base = 'tab'
  else if (event.key.length === 1) base = event.key.toLowerCase()
  else if (event.code.startsWith('Key')) base = event.code.slice(3).toLowerCase()
  else if (event.code.startsWith('Digit')) base = event.code.slice(5)
  else if (event.code === 'Slash') base = '/'
  else return null

  const parts: string[] = []
  if (event.metaKey || (event.ctrlKey && !apple)) parts.push('mod')
  if (event.ctrlKey && apple) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(base)
  return parts.join('+')
}

/** Read overrides from localStorage (corrupt → empty). Cached in memory —
 * keydown handlers must not pay a sync disk read every chord (Vercel
 * js-cache-storage). */
let shortcutOverridesCache: ShellShortcutOverrides | undefined

function isDefaultShortcutStorage(
  storage: Pick<Storage, 'getItem'> | null,
): boolean {
  return storage === (typeof localStorage !== 'undefined' ? localStorage : null)
}

export function loadShortcutOverrides(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): ShellShortcutOverrides {
  if (storage === null) return {}
  if (shortcutOverridesCache !== undefined && isDefaultShortcutStorage(storage)) {
    return shortcutOverridesCache
  }
  try {
    const raw = storage.getItem(SHELL_SHORTCUTS_STORAGE_KEY)
    if (raw === null || raw === '') {
      if (isDefaultShortcutStorage(storage)) shortcutOverridesCache = {}
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      if (isDefaultShortcutStorage(storage)) shortcutOverridesCache = {}
      return {}
    }
    const out: Partial<Record<ShellShortcutId, string>> = {}
    for (const def of SHELL_SHORTCUT_DEFS) {
      if (def.fixed) continue
      const value = (parsed as Record<string, unknown>)[def.id]
      if (typeof value !== 'string' || value.trim() === '') continue
      const combo = canonicalizeCombo(value)
      if (combo === '' || combo === def.defaultCombo) continue
      out[def.id] = combo
    }
    if (isDefaultShortcutStorage(storage)) shortcutOverridesCache = out
    return out
  } catch {
    if (isDefaultShortcutStorage(storage)) shortcutOverridesCache = {}
    return {}
  }
}

/** Persist override-only document (empty → remove key). */
export function saveShortcutOverrides(
  overrides: ShellShortcutOverrides,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (isDefaultShortcutStorage(storage)) shortcutOverridesCache = overrides
  if (storage === null) return
  try {
    const keys = Object.keys(overrides)
    if (keys.length === 0) {
      storage.removeItem(SHELL_SHORTCUTS_STORAGE_KEY)
      return
    }
    storage.setItem(SHELL_SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Quota / private mode — in-memory overrides still apply for this tab.
  }
}

/** Drop the in-memory shortcut override mirror (tests). */
export function clearShortcutOverridesCache(): void {
  shortcutOverridesCache = undefined
}

/** Effective combo for one id. */
export function effectiveCombo(id: ShellShortcutId, overrides: ShellShortcutOverrides = {}): string {
  const def = SHELL_SHORTCUT_DEFS.find((d) => d.id === id)
  if (def === undefined) return ''
  if (def.fixed) return def.defaultCombo
  return overrides[id] ?? def.defaultCombo
}

/** True when the effective binding differs from the shipped default. */
export function isCustomized(id: ShellShortcutId, overrides: ShellShortcutOverrides): boolean {
  const def = SHELL_SHORTCUT_DEFS.find((d) => d.id === id)
  if (def === undefined || def.fixed) return false
  const current = overrides[id]
  return current !== undefined && current !== def.defaultCombo
}

/** Set or clear one override; returns the next override map. */
export function setShortcutOverride(
  overrides: ShellShortcutOverrides,
  id: ShellShortcutId,
  combo: string,
): ShellShortcutOverrides {
  const def = SHELL_SHORTCUT_DEFS.find((d) => d.id === id)
  if (def === undefined || def.fixed) return overrides
  const next = canonicalizeCombo(combo)
  const copy: Partial<Record<ShellShortcutId, string>> = { ...overrides }
  if (next === '' || next === def.defaultCombo) {
    delete copy[id]
  } else {
    copy[id] = next
  }
  return copy
}

/** Restore one id to its shipped default. */
export function resetShortcutOverride(
  overrides: ShellShortcutOverrides,
  id: ShellShortcutId,
): ShellShortcutOverrides {
  if (overrides[id] === undefined) return overrides
  const copy: Partial<Record<ShellShortcutId, string>> = { ...overrides }
  delete copy[id]
  return copy
}

/**
 * Other action ids (including fixed) that already use `combo`.
 * Empty when free.
 */
export function conflictsFor(
  id: ShellShortcutId,
  combo: string,
  overrides: ShellShortcutOverrides,
): readonly ShellShortcutId[] {
  const needle = canonicalizeCombo(combo)
  if (needle === '') return []
  const hits: ShellShortcutId[] = []
  for (const def of SHELL_SHORTCUT_DEFS) {
    if (def.id === id) continue
    if (effectiveCombo(def.id, overrides) === needle) hits.push(def.id)
  }
  return hits
}

/** Match a keydown against effective bindings; returns the action id or null. */
export function matchShortcutEvent(
  event: KeyboardEvent,
  overrides: ShellShortcutOverrides,
  apple = isApplePlatform(),
): ShellShortcutId | null {
  const combo = comboFromEvent(event, apple)
  if (combo === null) return null
  const needle = canonicalizeCombo(combo, apple)
  for (const def of SHELL_SHORTCUT_DEFS) {
    if (effectiveCombo(def.id, overrides) === needle) return def.id
  }
  return null
}
