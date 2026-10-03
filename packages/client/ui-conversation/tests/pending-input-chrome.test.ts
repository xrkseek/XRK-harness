import { describe, expect, it } from 'vitest'
import type { ConversationLocation } from '@xrkseek/client-runtime/client'
import {
  durableSteerPending,
  groupPendingByChrome,
  pendingInputChrome,
} from '../src/client/chat/pending-input-chrome.ts'

describe('pendingInputChrome', () => {
  it('is steer while a turn is open even without a start clock', () => {
    expect(pendingInputChrome(true, true, null, 10)).toBe('steer')
  })

  it('is send after the turn yields', () => {
    expect(pendingInputChrome(false, false, 1, 10)).toBe('send')
  })

  it('is send when running lags after the turn closed', () => {
    expect(pendingInputChrome(true, false, null, 10)).toBe('send')
  })

  it('is send when a later turn has already started', () => {
    expect(pendingInputChrome(true, true, 20, 10)).toBe('send')
  })
})

describe('durableSteerPending', () => {
  const openTurn = { kind: 'turn', turn: { status: 'open' } } as ConversationLocation
  const closedTurn = { kind: 'turn', turn: { status: 'closed' } } as ConversationLocation

  it('badges an open owning turn', () => {
    expect(durableSteerPending('steering', true, openTurn, 5, true, 1)).toBe(true)
  })

  it('does not badge a closed owning turn even while running', () => {
    expect(durableSteerPending('steering', true, closedTurn, 5, true, 20)).toBe(false)
  })

  it('does not keep 插队中 when no turn is open (subagent notice after settle)', () => {
    expect(durableSteerPending('steering', true, { kind: 'session' }, 5, false, null)).toBe(false)
  })

  it('does not relabel a session-located steer after a later turn starts', () => {
    expect(durableSteerPending('steering', true, { kind: 'session' }, 5, true, 20)).toBe(false)
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
