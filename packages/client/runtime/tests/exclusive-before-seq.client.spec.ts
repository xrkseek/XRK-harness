import { describe, expect, it } from 'vitest'
import { exclusiveBeforeSeqForWireSeq } from '../src/client/sessions/exclusive-before-seq.ts'

describe('exclusiveBeforeSeqForWireSeq', () => {
  it('maps dense mux seq to index via wireSeq - 1 when the row is missing', () => {
    expect(exclusiveBeforeSeqForWireSeq({
      wireSeq: 16,
      eventSeqs: [],
      hasMore: false,
      baseSeq: 0,
    })).toBe(15)
  })

  it('uses array index when the window is the full log head', () => {
    // Post-truncate monotonic mux jump: kept 1..10, new human at 78.
    const eventSeqs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 78, 79]
    expect(exclusiveBeforeSeqForWireSeq({
      wireSeq: 78,
      eventSeqs,
      hasMore: false,
      baseSeq: 1,
    })).toBe(10)
    // Dense opener still maps to 0.
    expect(exclusiveBeforeSeqForWireSeq({
      wireSeq: 1,
      eventSeqs: [1, 2, 3],
      hasMore: false,
      baseSeq: 1,
    })).toBe(0)
  })

  it('anchors a history suffix on baseSeq', () => {
    // Contiguous history page starting at absolute seq 100 (101 rows → 100..200).
    const eventSeqs = Array.from({ length: 101 }, (_, i) => 100 + i)
    expect(exclusiveBeforeSeqForWireSeq({
      wireSeq: 150,
      eventSeqs,
      hasMore: true,
      baseSeq: 100,
    })).toBe(149)
    // Post-cut jump on a still-suffixed window: kept through 200, new human 301.
    const afterJump = [...eventSeqs, 301]
    expect(exclusiveBeforeSeqForWireSeq({
      wireSeq: 301,
      eventSeqs: afterJump,
      hasMore: true,
      baseSeq: 100,
    })).toBe(200)
  })
})
