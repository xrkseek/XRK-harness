// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  canonicalizeCombo,
  comboFromEvent,
  conflictsFor,
  effectiveCombo,
  formatCombo,
  isCustomized,
  loadShortcutOverrides,
  matchShortcutEvent,
  resetShortcutOverride,
  saveShortcutOverrides,
  setShortcutOverride,
  SHELL_SHORTCUTS_STORAGE_KEY,
} from '../src/client/shell-shortcuts.ts'

/** In-memory Storage stub (jsdom / Node may lack localStorage). */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() { return map.size },
    clear() { map.clear() },
    getItem(key: string) { return map.has(key) ? map.get(key)! : null },
    key(index: number) { return [...map.keys()][index] ?? null },
    removeItem(key: string) { map.delete(key) },
    setItem(key: string, value: string) { map.set(key, String(value)) },
  }
}

describe('shell-shortcuts', () => {
  it('canonicalizes mod/ctrl aliases and formats for display', () => {
    expect(canonicalizeCombo('Ctrl+/', false)).toBe('mod+/')
    expect(canonicalizeCombo('cmd+b', true)).toBe('mod+b')
    expect(formatCombo('mod+/', false)).toBe('Ctrl+/')
    expect(formatCombo('mod+/', true)).toBe('⌘+/')
    expect(formatCombo('shift+enter', false)).toBe('Shift+Enter')
  })

  it('persists override-only diffs and drops equal-to-default', () => {
    const storage = memoryStorage()
    saveShortcutOverrides({ 'layout.toggleSidebar': 'mod+s' }, storage)
    expect(storage.getItem(SHELL_SHORTCUTS_STORAGE_KEY)).toContain('layout.toggleSidebar')
    expect(loadShortcutOverrides(storage)).toEqual({ 'layout.toggleSidebar': 'mod+s' })
    expect(effectiveCombo('layout.toggleSidebar', loadShortcutOverrides(storage))).toBe('mod+s')
    expect(isCustomized('layout.toggleSidebar', loadShortcutOverrides(storage))).toBe(true)

    const reset = resetShortcutOverride(loadShortcutOverrides(storage), 'layout.toggleSidebar')
    saveShortcutOverrides(reset, storage)
    expect(storage.getItem(SHELL_SHORTCUTS_STORAGE_KEY)).toBeNull()
  })

  it('ignores equal-to-default and fixed composer overrides on load', () => {
    const storage = memoryStorage({
      [SHELL_SHORTCUTS_STORAGE_KEY]: JSON.stringify({
        'layout.toggleSidebar': 'mod+b',
        'composer.submit': 'mod+enter',
        'keybinds.openPanel': 'mod+k',
        garbage: 1,
      }),
    })
    expect(loadShortcutOverrides(storage)).toEqual({ 'keybinds.openPanel': 'mod+k' })
  })

  it('blocks conflicting chords against editable and fixed rows', () => {
    expect(conflictsFor('keybinds.openPanel', 'mod+enter', {})).toEqual(['composer.submit'])
    expect(conflictsFor('layout.toggleSidebar', 'mod+j', {})).toEqual(['layout.toggleDetails'])
    const next = setShortcutOverride({}, 'layout.toggleSidebar', 'mod+s')
    expect(conflictsFor('keybinds.openPanel', 'mod+s', next)).toEqual(['layout.toggleSidebar'])
    expect(conflictsFor('layout.toggleSidebar', 'mod+s', next)).toEqual([])
  })

  it('matches keydown events to effective bindings', () => {
    const open = new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true })
    expect(matchShortcutEvent(open, {}, false)).toBe('keybinds.openPanel')

    const sidebar = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })
    expect(matchShortcutEvent(sidebar, {}, false)).toBe('layout.toggleSidebar')

    const rebound = setShortcutOverride({}, 'layout.toggleSidebar', 'mod+s')
    const s = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
    expect(matchShortcutEvent(s, rebound, false)).toBe('layout.toggleSidebar')
    expect(matchShortcutEvent(sidebar, rebound, false)).toBeNull()
  })

  it('builds capture combos and ignores modifier-only presses', () => {
    expect(comboFromEvent(new KeyboardEvent('keydown', { key: 'Control' }), false)).toBeNull()
    expect(comboFromEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), false)).toBe('mod+k')
    expect(comboFromEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }), false)).toBe('shift+enter')
  })

  it('tolerates corrupt storage', () => {
    const storage = memoryStorage({ [SHELL_SHORTCUTS_STORAGE_KEY]: '{not-json' })
    expect(loadShortcutOverrides(storage)).toEqual({})
  })
})
