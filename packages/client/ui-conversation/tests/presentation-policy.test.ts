import { describe, expect, it } from 'vitest'
import {
  presentationPolicyFor,
  processGroupDeferred,
  processGroupSettled,
} from '../src/client/conversation-nodes/presentation-policy.ts'
import { TRANSCRIPT_VIEW_MODES } from '../src/submission-settings.ts'

describe('presentationPolicyFor', () => {
  it('folds a completed run in every mode except the expanded one', () => {
    expect(presentationPolicyFor('standard').foldCompletedTurns).toBe(true)
    expect(presentationPolicyFor('detailed').foldCompletedTurns).toBe(true)
    // `verbose` is the always-expanded posture: the run is never hidden.
    expect(presentationPolicyFor('verbose').foldCompletedTurns).toBe(false)
  })

  it('maps each mode onto the foldWhen axis', () => {
    expect(presentationPolicyFor('standard').foldWhen).toBe('process')
    expect(presentationPolicyFor('detailed').foldWhen).toBe('turn')
    expect(presentationPolicyFor('verbose').foldWhen).toBe('never')
  })

  it('groups every mode that can fold, and leaves verbose flat', () => {
    expect(presentationPolicyFor('standard').stepGrouping).toBe('collapsed')
    // Detailed stays grouped so the live Turn still has a run to animate closed.
    expect(presentationPolicyFor('detailed').stepGrouping).toBe('collapsed')
    expect(presentationPolicyFor('verbose').stepGrouping).toBe('none')
  })

  it('keeps taxonomy on modes that group process runs', () => {
    expect(presentationPolicyFor('standard').detailTitles).toBe(true)
    expect(presentationPolicyFor('detailed').detailTitles).toBe(true)
    expect(presentationPolicyFor('verbose').detailTitles).toBe(true)
  })

  it('shows live process detail in every mode that groups process runs', () => {
    // Open chrome names the live tool; a folded+running line still shimmers too.
    expect(presentationPolicyFor('standard').liveProcessDetail).toBe(true)
    expect(presentationPolicyFor('detailed').liveProcessDetail).toBe(true)
    // Verbose has no group header — live detail lives on each tool / think row.
    expect(presentationPolicyFor('verbose').liveProcessDetail).toBe(false)
  })

  it('folds on completion in every product mode', () => {
    // `next-input` exists on the axis but nothing selects it yet — the shipped
    // modes must keep folding the moment the run settles.
    expect(presentationPolicyFor('standard').collapseTiming).toBe('completion')
    expect(presentationPolicyFor('detailed').collapseTiming).toBe('completion')
    expect(presentationPolicyFor('verbose').collapseTiming).toBe('completion')
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

  it('latches immediately when foldWhen is immediate', () => {
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

describe('processGroupDeferred', () => {
  const newestTurn = { newestTurn: true, nextInputPending: false }

  it('collapses a settled run at completion when timing is completion', () => {
    expect(processGroupDeferred('completion', newestTurn)).toBe(false)
    expect(processGroupDeferred('completion', { newestTurn: false, nextInputPending: false })).toBe(false)
  })

  it('holds the newest Turn open until the reader sends again', () => {
    // `next-input`: the run the reader just watched stays readable after
    // turn/end — folding waits for the next submission.
    expect(processGroupDeferred('next-input', newestTurn)).toBe(true)
  })

  it('releases the fold once a newer Turn starts', () => {
    expect(processGroupDeferred('next-input', { newestTurn: false, nextInputPending: false })).toBe(false)
  })

  it('releases the fold while the next send is still in flight', () => {
    // The transcript echo is the reader's next input: fold now, so the new
    // Turn opens over a quiet transcript instead of the previous run.
    expect(processGroupDeferred('next-input', { newestTurn: true, nextInputPending: true })).toBe(false)
  })
})
