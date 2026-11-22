/**
 * @vitest-environment jsdom
 *
 * Placement policy: desktop at cursor (prefer below); phone + selection at
 * the pressed visible line (prefer above, centered on the finger).
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

function stubRangeRects(
  range: Range,
  union: DOMRect,
  lines: DOMRect[],
): void {
  range.getBoundingClientRect = () => union
  range.getClientRects = () => lines as unknown as DOMRectList
}

describe('resolveContextMenuPlacement', () => {
  it('fine pointer: opens below the cursor even with a selection', () => {
    stubPointer('fine')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
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

  it('fine pointer near the bottom of the viewport: flips above', () => {
    stubPointer('fine')
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'near bottom'
    document.body.append(prose)
    const event = new MouseEvent('contextmenu', { clientX: 40, clientY: 380, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('top')
    expect(placement.rect.x).toBe(40)
    expect(placement.rect.y).toBe(380)
  })

  it('coarse pointer + selection: prefers above the pressed line, centered on the finger', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'selected words'
    document.body.append(prose)
    selectAll(prose)
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    const range = live.getRangeAt(0)
    stubRangeRects(range, new DOMRect(40, 240, 200, 40), [new DOMRect(40, 240, 200, 40)])
    const event = new MouseEvent('contextmenu', { clientX: 80, clientY: 250, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('top')
    // Centered on finger X (80 − 148/2); inflated by handle clearance (32).
    expect(placement.rect.x).toBe(80 - 74)
    expect(placement.rect.top).toBe(240 - 32)
    expect(placement.rect.height).toBe(40 + 64)
    expect(placement.rect.width).toBe(148)
  })

  it('coarse pointer + tall selection: anchors the line nearest the press, not the union top', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'line one\nline two\nline three'
    document.body.append(prose)
    selectAll(prose)
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    const range = live.getRangeAt(0)
    stubRangeRects(
      range,
      new DOMRect(40, 200, 200, 200),
      [
        new DOMRect(40, 200, 200, 40),
        new DOMRect(40, 280, 200, 40),
        new DOMRect(40, 360, 200, 40),
      ],
    )
    const event = new MouseEvent('contextmenu', { clientX: 90, clientY: 370, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('top')
    expect(placement.rect.x).toBe(90 - 74)
    // Nearest line top 360 − handle clearance 32 — not union top 200.
    expect(placement.rect.top).toBe(360 - 32)
    expect(placement.rect.height).toBe(40 + 64)
  })

  it('coarse pointer + tall selection: ignores off-screen lines when a visible line exists', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'scrolled selection'
    document.body.append(prose)
    selectAll(prose)
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    const range = live.getRangeAt(0)
    // First line scrolled away; finger is mid-viewport on the second line.
    stubRangeRects(
      range,
      new DOMRect(40, -80, 200, 200),
      [
        new DOMRect(40, -80, 200, 40),
        new DOMRect(40, 200, 200, 40),
        new DOMRect(40, 280, 200, 40),
      ],
    )
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 210, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.rect.top).toBe(200 - 32)
  })

  it('coarse pointer + selection near the top: flips below', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'near top'
    document.body.append(prose)
    selectAll(prose)
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    stubRangeRects(
      live.getRangeAt(0),
      new DOMRect(20, 8, 180, 24),
      [new DOMRect(20, 8, 180, 24)],
    )
    const event = new MouseEvent('contextmenu', { clientX: 60, clientY: 16, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    expect(placement.side).toBe('bottom')
  })

  it('coarse pointer + (0,0) gesture: falls back to the line center', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const prose = document.createElement('p')
    prose.textContent = 'webview zero point'
    document.body.append(prose)
    selectAll(prose)
    const live = window.getSelection()
    if (live === null || live.rangeCount === 0) throw new Error('no range')
    stubRangeRects(
      live.getRangeAt(0),
      new DOMRect(40, 300, 200, 40),
      [new DOMRect(40, 300, 200, 40)],
    )
    const event = new MouseEvent('contextmenu', { clientX: 0, clientY: 0, bubbles: true })
    Object.defineProperty(event, 'target', { value: prose })
    const hit = readContextMenuHit(event)
    const placement = resolveContextMenuPlacement(hit)
    // Line center X = 140; card left = 140 − 74.
    expect(placement.rect.x).toBe(140 - 74)
    expect(placement.rect.top).toBe(300 - 32)
  })

  it('coarse pointer without selection: falls back to the pointer', () => {
    stubPointer('coarse')
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
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
