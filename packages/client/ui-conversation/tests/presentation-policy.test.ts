import { describe, expect, it } from 'vitest'
import {
  presentationPolicyFor,
  processGroupSettled,
} from '../src/client/conversation-nodes/presentation-policy.ts'
import { TRANSCRIPT_VIEW_MODES } from '../src/submission-settings.ts'

describe('presentationPolicyFor', () => {
  it('folds a completed run in every mode except the expanded one', () => {
    expect(presentationPolicyFor('compact').foldCompletedTurns).toBe(true)
    expect(presentationPolicyFor('standard').foldCompletedTurns).toBe(true)
    expect(presentationPolicyFor('detailed').foldCompletedTurns).toBe(true)
    // `verbose` is the always-expanded posture: the run is never hidden.
    expect(presentationPolicyFor('verbose').foldCompletedTurns).toBe(false)
  })

  it('maps each mode onto the four-point foldWhen axis', () => {
    expect(presentationPolicyFor('compact').foldWhen).toBe('immediate')
    expect(presentationPolicyFor('standard').foldWhen).toBe('process')
    expect(presentationPolicyFor('detailed').foldWhen).toBe('turn')
    expect(presentationPolicyFor('verbose').foldWhen).toBe('never')
  })

  it('groups every mode that can fold, and leaves verbose flat', () => {
    expect(presentationPolicyFor('compact').stepGrouping).toBe('collapsed')
    expect(presentationPolicyFor('standard').stepGrouping).toBe('collapsed')
    // Detailed stays grouped so the live Turn still has a run to animate closed.
    expect(presentationPolicyFor('detailed').stepGrouping).toBe('collapsed')
    expect(presentationPolicyFor('verbose').stepGrouping).toBe('none')
  })

  it('drops the taxonomy before the count', () => {
    expect(presentationPolicyFor('compact').detailTitles).toBe(false)
    expect(presentationPolicyFor('standard').detailTitles).toBe(true)
    expect(presentationPolicyFor('detailed').detailTitles).toBe(true)
    expect(presentationPolicyFor('verbose').detailTitles).toBe(true)
  })

  it('shows live process detail only in standard and detailed', () => {
    expect(presentationPolicyFor('compact').liveProcessDetail).toBe(false)
    expect(presentationPolicyFor('standard').liveProcessDetail).toBe(true)
    expect(presentationPolicyFor('detailed').liveProcessDetail).toBe(true)
    expect(presentationPolicyFor('verbose').liveProcessDetail).toBe(false)
  })

  it('returns one stable object per mode', () => {
    for (const mode of TRANSCRIPT_VIEW_MODES) {
      expect(presentationPolicyFor(mode)).toBe(presentationPolicyFor(mode))
      expect(presentationPolicyFor(mode).mode).toBe(mode)
    }
  })
})

describe('processGroupSettled', () => {
  const openRunning = { closed: false, summary: { running: true, tools: 2 } }
  const openSettled = { closed: false, summary: { running: false, tools: 2 } }
  const closedSettled = { closed: true, summary: { running: false, tools: 2 } }

  it('latches immediately under compact', () => {
    expect(processGroupSettled('immediate', openRunning, false)).toBe(true)
  })

  it('folds standard once the tool burst ends', () => {
    expect(processGroupSettled('process', openRunning, false)).toBe(false)
    expect(processGroupSettled('process', openSettled, false)).toBe(true)
    expect(processGroupSettled('process', closedSettled, false)).toBe(true)
  })

  it('keeps detailed open until the Turn closes', () => {
    expect(processGroupSettled('turn', openSettled, false)).toBe(false)
    expect(processGroupSettled('turn', closedSettled, false)).toBe(true)
    expect(processGroupSettled('turn', openSettled, true)).toBe(true)
  })

  it('never settles under verbose', () => {
    expect(processGroupSettled('never', closedSettled, true)).toBe(false)
  })
})
