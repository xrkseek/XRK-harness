/**
 * @vitest-environment jsdom
 *
 * Placement policy: desktop stays at the cursor; phone + selection floats
 * above the highlight with handle clearance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readContextMenuHit } from '../src/context-menu.ts'
import { resolveContextMenuPlacement } from '../src/contextMenuPlacement.ts'

function stubPointer(kind: 'fine' | 'coarse'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'coarse'
      ? query.includes('pointer: coarse')
      : query.includes('pointer: fine'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }))
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.unstubAllGlobals()
})

function selectAll(el: HTMLElement): void {
  const selection = window.getSelection()
  if (selection === null) throw new Error('no Selection')
  const range = document.createRange()
  range.selectNodeContents(el)
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('resolveContextMenuPlacement', () => {
  it('fine pointer: opens below the cursor even with a selection', () => {
    stubPointer('fine')
    const prose = document.createElement('p')
    prose.textContent = 'selected words'
    document.body.append(prose)
    selectAll(prose)
    const event = new MouseEvent('contextmenu', { clientX: 120, clientY: 200, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('bottom')
    expect(placement.rect.x).toBe(120)
    expect(placement.rect.y).toBe(200)
    expect(placement.rect.width).toBe(0)
  })

  it('coarse pointer + selection: prefers above the highlight', () => {
    stubPointer('coarse')
    const prose = document.createElement('p')
    prose.textContent = 'selected words'
    // jsdom getBoundingClientRect is zeros — stub a mid-viewport box so
    // room-above succeeds and side resolves to top.
    prose.getBoundingClientRect = () =>
      new DOMRect(40, 240, 200, 40) as DOMRect
    document.body.append(prose)
    selectAll(prose)
    // Range rect also needs a non-zero box in jsdom.
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    const range = live.getRangeAt(0)
    range.getBoundingClientRect = () => new DOMRect(40, 240, 200, 40)
    const event = new MouseEvent('contextmenu', { clientX: 80, clientY: 250, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('top')
    // Inflated upward by handle clearance (32).
    expect(placement.rect.top).toBe(240 - 32)
    expect(placement.rect.height).toBe(40 + 64)
  })

  it('coarse pointer without selection: falls back to the pointer', () => {
    stubPointer('coarse')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.textContent = 'caret only'
    document.body.append(editable)
    const event = new MouseEvent('contextmenu', { clientX: 16, clientY: 48, bubbles: true })
    Object.defineProperty(event, 'target', { value: editable })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('bottom')
    expect(placement.rect.x).toBe(16)
    expect(placement.rect.y).toBe(48)
  })
})
