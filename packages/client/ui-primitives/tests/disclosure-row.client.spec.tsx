/**
 * @vitest-environment jsdom
 *
 * Phone used to force the leading slot to a down-chevron via
 * `@media (hover: none)` + iconIdle/chevronHover swap. Desktop hover hid the
 * type icon only while hovering; leave → type icon again. Touch never leaves
 * "hover", so every think/command row looked like 「∨」 with no type icon.
 *
 * Leading stays the type icon; expand state is the trailing › / ∨ only.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DisclosureRow } from '../src/DisclosureRow.tsx'

const here = dirname(fileURLToPath(import.meta.url))
const cssPath = join(here, '../src/DisclosureRow.module.css')
const rowCss = readFileSync(cssPath, 'utf8')

describe('DisclosureRow expand chrome', () => {
  let host: HTMLDivElement
  let root: Root

  function mount(open: boolean): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root.render(createElement(DisclosureRow, {
        icon: createElement('span', { 'data-testid': 'type-icon' }, 'T'),
        title: '思考',
        open,
        expandable: true,
        expandOnRowClick: true,
        onToggle: vi.fn(),
      }))
    })
  }

  function unmount(): void {
    act(() => { root.unmount() })
    host.remove()
  }

  it('keeps the type icon when open and when collapsed', () => {
    mount(false)
    expect(host.querySelector('[data-testid="type-icon"]')).not.toBeNull()
    unmount()
    mount(true)
    expect(host.querySelector('[data-testid="type-icon"]')).not.toBeNull()
    unmount()
  })

  it('puts expand state on a trailing chevron, not the leading slot', () => {
    mount(true)
    const leading = host.querySelector('[class*="leading"]')
    expect(leading?.querySelector('[data-testid="type-icon"]')).not.toBeNull()
    expect(leading?.querySelector('svg')).toBeNull()
    expect(host.querySelector('[class*="trailChevron"]')).not.toBeNull()
    unmount()
  })

  it('never forces a touch-only leading chevron via CSS', () => {
    expect(rowCss).not.toMatch(/@media\s*\(\s*hover:\s*none/)
    expect(rowCss).not.toMatch(/chevronHover/)
    expect(rowCss).not.toMatch(/iconIdle/)
  })
})
