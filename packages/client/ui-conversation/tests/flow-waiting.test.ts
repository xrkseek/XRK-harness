import { describe, expect, it } from 'vitest'
import type { ConversationTimelineSnapshot, PartialAssistant, StepLocation, TurnLocation } from '@xrkseek/client-runtime/client'
import { shouldShowFlowWaiting } from '../src/client/chat/flow-waiting.ts'

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
    pendingSteerCount: 0,
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

  it('shows while steer is pending or at the flow tail', () => {
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
      pendingSteerCount: 1,
    })).toBe(true)
    expect(shouldShowFlowWaiting({
      ...base(partial),
      timeline,
      tailKind: 'steering',
    })).toBe(true)
  })
})
