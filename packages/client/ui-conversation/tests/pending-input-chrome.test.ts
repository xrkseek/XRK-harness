import { describe, expect, it } from 'vitest'
import type { ConversationLocation } from '@xrkseek/client-runtime/client'
import {
  collectUserShapedSeqs,
  collectUserShapedTimes,
  composerDeliveryBusy,
  durableSteerPending,
  groupPendingByChrome,
  hasLiveAgentWork,
  isTurnInFlight,
  isTurnOpenerRow,
} from '../src/client/chat/pending-input-chrome.ts'

describe('isTurnInFlight', () => {
  it('is in flight while live and a turn is open', () => {
    expect(isTurnInFlight(true, true, false)).toBe(true)
  })

  it('is idle after Stop even if the Turn object is still open', () => {
    expect(isTurnInFlight(false, true, false)).toBe(false)
  })

  it('is idle when the turn has already ended even if Host running lags', () => {
    expect(isTurnInFlight(true, false, true)).toBe(false)
  })

  it('is in flight while Host is running before any Turn is in the timeline', () => {
    expect(isTurnInFlight(true, false, false)).toBe(true)
  })
})

describe('durableSteerPending', () => {
  const openTurn = { kind: 'turn', turn: { status: 'open' } } as ConversationLocation
  const closedTurn = { kind: 'turn', turn: { status: 'closed' } } as ConversationLocation
  const openStep = {
    kind: 'step',
    turn: { status: 'open' },
    step: { status: 'open' },
  } as ConversationLocation
  const closedStep = {
    kind: 'step',
    turn: { status: 'open' },
    step: { status: 'closed' },
  } as ConversationLocation

  it('does not badge a row whose seq opened this turn', () => {
    expect(durableSteerPending('steering', openTurn, 1, true)).toBe(false)
  })

  it('badges a turn-located steer in the step/end vacuum', () => {
    expect(durableSteerPending('steering', openTurn, 5, true, [1, 5])).toBe(true)
  })

  it('does not badge the user row that opened this turn', () => {
    expect(durableSteerPending('user', openTurn, 1, true)).toBe(false)
  })

  it('does not badge the first user on a turn that only has inject waiting', () => {
    expect(durableSteerPending('user', openTurn, 5, true, [])).toBe(false)
  })

  it('badges a user row admitted after this turn started while live', () => {
    expect(durableSteerPending('user', openTurn, 5, true, [1, 5])).toBe(true)
  })

  it('returns a user follow-up to idle after Stop', () => {
    expect(durableSteerPending('user', openTurn, 5, false, [1, 5])).toBe(false)
  })

  it('badges a still-open step', () => {
    expect(durableSteerPending('steering', openStep, 5, true, [1, 5])).toBe(true)
  })

  it('still badges after the current step closed while the turn is live', () => {
    expect(durableSteerPending('steering', closedStep, 5, true, [1, 5])).toBe(true)
  })

  it('does not badge a closed owning turn', () => {
    expect(durableSteerPending('steering', closedTurn, 20, true)).toBe(false)
  })

  it('badges a session follow-up while running even after inject turns have closed', () => {
    expect(durableSteerPending('steering', { kind: 'session' }, 5, true, [1, 5])).toBe(true)
  })

  it('badges a session follow-up while running before turn/start is in the timeline', () => {
    expect(durableSteerPending('user', { kind: 'session' }, 5, true, [1, 5])).toBe(true)
    expect(durableSteerPending('user', { kind: 'session' }, 1, true, [1, 5])).toBe(false)
  })

  it('does not keep 插队中 after Stop while the Turn object is still open', () => {
    expect(durableSteerPending('steering', { kind: 'session' }, 5, false, [1, 5])).toBe(false)
  })

  it('does not guess 插队 on a user opener before turn start is known', () => {
    expect(durableSteerPending('user', openTurn, 5, true)).toBe(false)
  })

  it('badges a session-located steer while the turn is live', () => {
    expect(durableSteerPending('steering', { kind: 'session' }, 5, true, [1, 5])).toBe(true)
  })

  it('does not relabel a session-located lone steer when it is the only human row', () => {
    expect(durableSteerPending('steering', { kind: 'session' }, 5, true)).toBe(false)
  })

  it('badges a follow-up when the opener precedes turn/start', () => {
    expect(durableSteerPending('user', openTurn, 3_000, true, [500, 3_000])).toBe(true)
    expect(durableSteerPending('user', openTurn, 500, true, [500, 3_000])).toBe(false)
  })

  it('badges the later seq when two user rows share a clock', () => {
    expect(durableSteerPending('user', { kind: 'session' }, 2, true, [1, 2])).toBe(true)
    expect(durableSteerPending('user', { kind: 'session' }, 1, true, [1, 2])).toBe(false)
  })

  it('badges a steering follow-up even when its seq is before the opener clock', () => {
    expect(durableSteerPending('steering', { kind: 'session' }, 500, true, [100, 500])).toBe(true)
  })

  it('badges a lone steering follow-up after assistant work', () => {
    expect(durableSteerPending(
      'steering', { kind: 'session' }, 3, true, [3], true,
    )).toBe(true)
  })

  it('does not trail a steer that opened the latest open turn (idle new-turn opener)', () => {
    const turn2 = {
      kind: 'turn' as const,
      turn: { status: 'open' as const, turn: 2 },
    } as ConversationLocation
    expect(durableSteerPending(
      'steering', turn2, 9, true, [9], true, 2,
    )).toBe(false)
    expect(durableSteerPending(
      'user', turn2, 9, true, [9], true, 2,
    )).toBe(false)
  })
})

describe('isTurnOpenerRow', () => {
  it('picks the earliest live-turn user even if that clock is before turn/start', () => {
    expect(isTurnOpenerRow(500, [500, 3_000])).toBe(true)
    expect(isTurnOpenerRow(3_000, [500, 3_000])).toBe(false)
  })

  it('does not treat two rows with the same clock as both openers', () => {
    expect(isTurnOpenerRow(2, [1, 2])).toBe(false)
    expect(isTurnOpenerRow(1, [1, 2])).toBe(true)
  })
})

describe('composerDeliveryBusy', () => {
  it('is busy once any live-turn user exists, including an opener before the clock', () => {
    expect(composerDeliveryBusy(true, [500])).toBe(true)
    expect(composerDeliveryBusy(true, [])).toBe(false)
    expect(composerDeliveryBusy(false, [500])).toBe(false)
  })
})

describe('collectUserShapedTimes', () => {
  const closedTurn = { kind: 'turn', turn: { status: 'closed' } } as ConversationLocation
  const openTurn = { kind: 'turn', turn: { status: 'open' } } as ConversationLocation

  it('keeps session and open-turn users and drops closed-turn history', () => {
    expect(collectUserShapedTimes([
      { kind: 'user', location: { kind: 'session' }, data: { time: 500 } },
      { kind: 'user', location: closedTurn, data: { time: 800 } },
      { kind: 'user', location: openTurn, data: { time: 3_000 } },
      { kind: 'assistant', data: { time: 4_000 } },
    ])).toEqual([500, 3_000])
  })

  it('drops a steering copy of the earliest user opener', () => {
    expect(collectUserShapedTimes([
      { kind: 'steering', data: { time: 2_500, content: [{ type: 'text', text: '在干嘛' }] } },
      { kind: 'user', data: { time: 3_000, content: [{ type: 'text', text: '在干嘛' }] } },
    ])).toEqual([3_000])
  })
})

describe('hasLiveAgentWork', () => {
  it('ignores assistant rows on a closed prior Turn', () => {
    const closed = { kind: 'turn', turn: { status: 'closed', turn: 1 } } as ConversationLocation
    const open = { kind: 'turn', turn: { status: 'open', turn: 2 } } as ConversationLocation
    expect(hasLiveAgentWork([
      { kind: 'assistant-step', location: closed },
    ], 1)).toBe(false)
    expect(hasLiveAgentWork([
      { kind: 'assistant-step', location: closed },
      { kind: 'tool-call', location: open },
    ], 2)).toBe(true)
  })
})

describe('collectUserShapedSeqs', () => {
  it('drops users on a closed Turn so the next 轮次 opener is not mixed in', () => {
    const closedLatest = { kind: 'turn', turn: { status: 'closed', turn: 1 } } as ConversationLocation
    expect(collectUserShapedSeqs([
      { kind: 'user', location: closedLatest, data: { seq: 1, time: 1_000 } },
      { kind: 'user', location: closedLatest, data: { seq: 2, time: 1_000 } },
    ], 1)).toEqual([])
  })
})

describe('groupPendingByChrome', () => {
  it('merges consecutive send rows and keeps steers separate', () => {
    const groups = groupPendingByChrome(
      ['a', 'b', 'c', 'd'] as const,
      (item) => (item === 'c' ? 'steer' : 'send'),
    )
    expect(groups.map((group) => [group.chrome, [...group.items]])).toEqual([
      ['send', ['a', 'b']],
      ['steer', ['c']],
      ['send', ['d']],
    ])
  })
})
