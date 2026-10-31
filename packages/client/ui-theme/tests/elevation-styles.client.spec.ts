// @vitest-environment node
/**
 * Elevation + theme-critical alias tokens community skins read from DSH.
 * Asserted against CSS text on disk (same contract as scrollbar-styles).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, '../src/styles')
const read = (name: string): string => readFileSync(join(STYLES, name), 'utf8')

const sheetCss = read('gradient-shadow-text.css')
const platformCss = read('design-platform.css')

describe('elevation tokens (DSH underlay)', () => {
  it('defaults stroke color on body and derives panel/prominent/soft per element', () => {
    expect(sheetCss).toMatch(
      /body\s*\{[^}]*--dsw-elevation-stroke-color:\s*var\(--dsw-alias-border-l4\)/s,
    )
    expect(sheetCss).toMatch(/body,\s*\nbody \*\s*\{/)
    expect(sheetCss).toContain('--dsw-elevation-stroke:')
    expect(sheetCss).toContain('--dsw-elevation-panel:')
    expect(sheetCss).toContain('--dsw-elevation-prominent:')
    expect(sheetCss).toContain('--dsw-elevation-soft:')
    expect(sheetCss).toMatch(
      /body\[data-ds-dark-theme\]\s+\[data-menu-material\]\s*\{[^}]*--dsw-elevation-stroke-color:\s*var\(--dsw-alias-border-l3\)/s,
    )
  })

  it('keeps menu backdrop filter for translucent surfaces', () => {
    expect(sheetCss).toContain('--dsw-menu-backdrop-filter: blur(40px) saturate(150%)')
  })
})

describe('theme alias tokens (DSH underlay)', () => {
  const required = [
    '--dsw-alias-label-shimmer',
    '--dsw-alias-label-deep-diving',
    '--dsw-alias-label-deep-diving-shimmer',
    '--dsw-alias-menu-icon',
    '--dsw-alias-state-idle-primary',
    '--dsw-alias-toast-label',
    '--dsw-alias-tooltip-key-bg',
    '--dsw-alias-turn-trigger-bg',
    '--dsw-alias-turn-trigger-bg-hover',
  ] as const

  it('declares light and dark palette values for shimmer / idle / turn-trigger', () => {
    for (const token of required) {
      const hits = platformCss.split(token).length - 1
      expect(hits, token).toBeGreaterThanOrEqual(2)
    }
  })
})
