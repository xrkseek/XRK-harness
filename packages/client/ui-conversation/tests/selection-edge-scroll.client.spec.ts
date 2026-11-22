/**
 * @vitest-environment jsdom
 *
 * Selection edge-scroll: step curve + direction from the pressed line.
 * Idle / union-straddle cases must not whip the transcript.
 */
import { describe, expect, it } from 'vitest'
import {
  pointerNearSelection,
  selectionAnchorBounds,
  selectionEdgeScrollDelta,
  selectionEdgeStep,
} from '../src/client/chat/use-selection-edge-scroll.ts'

describe('selectionEdgeStep', () => {
  it('is minimal at the inner edge and max at the rim', () => {
    expect(selectionEdgeStep(0, 40, 10)).toBe(3)
    expect(selectionEdgeStep(40, 40, 10)).toBe(10)
    expect(selectionEdgeStep(20, 40, 10)).toBe(3 + 7 * 0.25)
  })

  it('clamps depth outside the band', () => {
    expect(selectionEdgeStep(-8, 40, 10)).toBe(3)
    expect(selectionEdgeStep(80, 40, 14)).toBe(14)
  })
})

describe('selectionEdgeScrollDelta', () => {
  const port = { portTop: 100, portBottom: 700, coarse: false as const }

  it('scrolls up only when the pressed line enters the top band', () => {
    expect(selectionEdgeScrollDelta({
      ...port,
      bounds: { top: 120, bottom: 140 },
    })).toBeLessThan(0)
  })

  it('scrolls down only when the pressed line enters the bottom band', () => {
    expect(selectionEdgeScrollDelta({
      ...port,
      bounds: { top: 640, bottom: 680 },
    })).toBeGreaterThan(0)
  })

  it('stays idle when the pressed line sits in the middle', () => {
    expect(selectionEdgeScrollDelta({
      ...port,
      bounds: { top: 300, bottom: 340 },
    })).toBe(0)
  })
})

describe('pointerNearSelection', () => {
  it('is true on the highlight and false well away from it', () => {
    const host = document.createElement('p')
    host.textContent = 'selected'
    document.body.append(host)
    const selection = window.getSelection()
    if (selection === null) throw new Error('no Selection')
    const range = document.createRange()
    range.selectNodeContents(host)
    selection.removeAllRanges()
    selection.addRange(range)
    range.getClientRects = () =>
      [new DOMRect(40, 200, 120, 24)] as unknown as DOMRectList

    expect(pointerNearSelection(selection, 50, 210)).toBe(true)
    expect(pointerNearSelection(selection, 400, 600)).toBe(false)

    selection.removeAllRanges()
    host.remove()
  })
})

describe('selectionAnchorBounds', () => {
  it('picks the line nearest the pointer instead of the union span', () => {
    const host = document.createElement('p')
    host.textContent = 'one two three'
    document.body.append(host)
    const selection = window.getSelection()
    if (selection === null) throw new Error('no Selection')
    const range = document.createRange()
    range.selectNodeContents(host)
    selection.removeAllRanges()
    selection.addRange(range)
    range.getClientRects = () =>
      [
        new DOMRect(10, 100, 200, 20),
        new DOMRect(10, 400, 200, 20),
        new DOMRect(10, 700, 200, 20),
      ] as unknown as DOMRectList
    range.getBoundingClientRect = () => new DOMRect(10, 100, 200, 620)

    const nearBottom = selectionAnchorBounds(selection, { x: 40, y: 705 })
    expect(nearBottom).toEqual({ top: 700, bottom: 720 })

    const nearTop = selectionAnchorBounds(selection, { x: 40, y: 105 })
    expect(nearTop).toEqual({ top: 100, bottom: 120 })

    selection.removeAllRanges()
    host.remove()
  })
})
