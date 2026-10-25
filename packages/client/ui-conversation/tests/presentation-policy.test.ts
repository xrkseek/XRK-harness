import { describe, expect, it } from 'vitest'
import { presentationPolicyFor } from '../src/client/conversation-nodes/presentation-policy.ts'
import { TRANSCRIPT_VIEW_MODES } from '../src/submission-settings.ts'

describe('presentationPolicyFor', () => {
  it('folds a completed run in every mode except the expanded one', () => {
    expect(presentationPolicyFor('compact').foldCompletedTurns).toBe(true)
    expect(presentationPolicyFor('standard').foldCompletedTurns).toBe(true)
    expect(presentationPolicyFor('detailed').foldCompletedTurns).toBe(true)
    // `verbose` is the always-expanded posture: the run is never hidden.
    expect(presentationPolicyFor('verbose').foldCompletedTurns).toBe(false)
  })

  it('only groups history in detailed', () => {
    expect(presentationPolicyFor('compact').stepGrouping).toBe('collapsed')
    expect(presentationPolicyFor('standard').stepGrouping).toBe('collapsed')
    // The live Turn stays flat; the reader is watching those rows arrive.
    expect(presentationPolicyFor('detailed').stepGrouping).toBe('history')
    expect(presentationPolicyFor('verbose').stepGrouping).toBe('none')
  })

  it('drops the taxonomy before the count', () => {
    expect(presentationPolicyFor('compact').detailTitles).toBe(false)
    expect(presentationPolicyFor('standard').detailTitles).toBe(true)
    expect(presentationPolicyFor('detailed').detailTitles).toBe(true)
    expect(presentationPolicyFor('verbose').detailTitles).toBe(true)
  })

  it('returns one stable object per mode', () => {
    for (const mode of TRANSCRIPT_VIEW_MODES) {
      expect(presentationPolicyFor(mode)).toBe(presentationPolicyFor(mode))
      expect(presentationPolicyFor(mode).mode).toBe(mode)
    }
  })
})
