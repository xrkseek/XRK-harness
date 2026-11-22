/**
 * @vitest-environment jsdom
 *
 * Proximity step curve for selection edge-scroll — keeps phone drag-select
 * readable instead of whipping the transcript.
 */
import { describe, expect, it } from 'vitest'
import { selectionEdgeStep } from '../src/client/chat/use-selection-edge-scroll.ts'

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
