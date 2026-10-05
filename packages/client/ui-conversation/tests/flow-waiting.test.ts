import { describe, expect, it } from 'vitest'
import type { ConversationTimelineSnapshot, PartialAssistant, StepLocation, TurnLocation } from '@xrkseek/client-runtime/client'
import { isComposerAgentActive, shouldShowFlowWaiting } from '../src/client/chat/flow-waiting.ts'

const EMPTY_TIMELINE: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() }

function turn(steps: readonly StepLocation[], status: TurnLocation['status'] = 'open'): TurnLocation {
  return {
    turn: 1,
    status,
    steps,
    start: undefined,
    end: undefined,
    data: undefined as never,
  }
}

function openStep(step: number): StepLocation {
  return {
    turn: 1,
    step,
    status: 'open',
    start: undefined,
    end: undefined,
    data: undefined as never,
  }
}

function closedStep(step: number): StepLocation {
  return { ...openStep(step), status: 'closed' }
}

function base(partial: PartialAssistant | null = null) {
  return {
    running: true,
    partial,
    runningCallCount: 0,
    timeline: EMPTY_TIMELINE,
    tailKind: undefined as string | undefined,
  }
}

describe('shouldShowFlowWaiting', () => {
  it('shows while running with no live surface (pre-Think vacuum)', () => {
    expect(shouldShowFlowWaiting(base())).toBe(true)
  })

  it('hides when not running', () => {
    expect(shouldShowFlowWaiting({ ...base(), running: false })).toBe(false)
  })

  it('hides during tool execution', () => {
    expect(shouldShowFlowWaiting({ ...base(), runningCallCount: 1 })).toBe(false)
  })

  it('hides during live Think on an open step', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 0,
      blocks: [{ kind: 'reasoning', text: 'planning' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([openStep(0)])]]),
    }
    expect(shouldShowFlowWaiting({ ...base(partial), timeline })).toBe(false)
  })

  it('shows after send before first token (empty partial blocks)', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 0,
      blocks: [{ kind: 'reasoning', text: '' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([openStep(0)])]]),
    }
    expect(shouldShowFlowWaiting({ ...base(partial), timeline })).toBe(true)
  })

  it('shows across a closed-step gap when partial is stale', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 1,
      blocks: [{ kind: 'reasoning', text: 'old step think' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([closedStep(1), openStep(2)])]]),
    }
    expect(shouldShowFlowWaiting({ ...base(partial), timeline })).toBe(true)
  })

  it('hides while the user can still watch live Think, even with a human tail', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 0,
      blocks: [{ kind: 'reasoning', text: 'still streaming' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([openStep(0)])]]),
    }
    expect(shouldShowFlowWaiting({
      ...base(partial),
      timeline,
      skippedTrailingRunningStep: true,
      tailKind: 'steering',
    })).toBe(false)
  })

  it('shows after a human line at the tail when nothing new is streaming', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 0,
      blocks: [{ kind: 'reasoning', text: 'old think still mounted' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([openStep(0)])]]),
    }
    expect(shouldShowFlowWaiting({
      ...base(partial),
      timeline,
      tailKind: 'steering',
    })).toBe(true)
    expect(shouldShowFlowWaiting({
      ...base(),
      tailKind: 'user',
    })).toBe(true)
  })

  it('hides when running lags after every turn has closed', () => {
    expect(shouldShowFlowWaiting({
      ...base(),
      turnsSettled: true,
      tailKind: 'turn-tail',
    })).toBe(false)
  })

  it('still shows a tool vacuum after the owning turn has closed', () => {
    expect(shouldShowFlowWaiting({
      ...base(),
      turnsSettled: true,
      tailKind: 'tool-result',
    })).toBe(true)
  })

  it('shows after send before the next turn opens (settled timeline, new user tail)', () => {
    expect(shouldShowFlowWaiting({
      ...base(),
      turnsSettled: true,
      tailKind: 'user',
    })).toBe(true)
    expect(shouldShowFlowWaiting({
      ...base(),
      turnsSettled: true,
      tailKind: 'turn-tail',
      pendingSendCount: 1,
    })).toBe(true)
  })

  it('shows after a settled tool even when leftover Think is still on the open step', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 0,
      blocks: [{ kind: 'reasoning', text: 'plan then call bash' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([openStep(0)])]]),
    }
    expect(shouldShowFlowWaiting({
      ...base(partial),
      timeline,
      tailKind: 'tool-result',
    })).toBe(true)
    expect(shouldShowFlowWaiting({
      running: true,
      tailKind: 'tool-result',
      turnSurfaceActive: true,
      runningCallCount: 0,
    })).toBe(true)
  })

  it('hides when a trailing running step follows a settled tool (live Think after tools)', () => {
    const partial: PartialAssistant = {
      turn: 1,
      step: 1,
      blocks: [{ kind: 'reasoning', text: 'next layer' }],
    }
    const timeline: ConversationTimelineSnapshot = {
      turnOrder: [1],
      turns: new Map([[1, turn([closedStep(0), openStep(1)])]]),
    }
    expect(shouldShowFlowWaiting({
      ...base(partial),
      timeline,
      tailKind: 'tool-call',
      skippedTrailingRunningStep: true,
    })).toBe(false)
  })

  it('still hides during an in-flight tool even when the tail is a tool row', () => {
    expect(shouldShowFlowWaiting({
      ...base(),
      runningCallCount: 1,
      tailKind: 'tool-call',
    })).toBe(false)
  })
})

describe('isComposerAgentActive', () => {
  it('follows Host running only — leftover tools or Think do not keep Stop', () => {
    expect(isComposerAgentActive({
      running: true,
      runningCallCount: 0,
      partial: null,
    })).toBe(true)
    expect(isComposerAgentActive({
      running: false,
      runningCallCount: 2,
      partial: {
        turn: 1,
        step: 0,
        blocks: [{ kind: 'text', text: 'still streaming' }],
      },
    })).toBe(false)
  })
})
