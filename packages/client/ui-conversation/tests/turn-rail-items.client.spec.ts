import { describe, expect, it } from 'vitest'
import type { TurnNavigationItem } from '@xrkseek/client-runtime/client'
import { mergeTurnRailItems } from '../src/client/chat/turn-rail-items.ts'

describe('mergeTurnRailItems', () => {
  it('returns a stable empty array when both sides are empty', () => {
    expect(mergeTurnRailItems([], undefined)).toBe(mergeTurnRailItems([], null))
    expect(mergeTurnRailItems([], undefined)).toEqual([])
  })

  it('keeps loaded anchors and fills empty previews from the outline', () => {
    const loaded: readonly TurnNavigationItem[] = [
      { turn: 2, anchorKey: 'u2', prompt: 'loaded prompt', response: '' },
    ]
    const outline = [
      { turn: 1, seq: 10, prompt: 'older', response: 'old reply' },
      { turn: 2, seq: 20, prompt: 'outline prompt', response: 'outline reply' },
    ]
    expect(mergeTurnRailItems(loaded, outline)).toEqual([
      {
        turn: 1,
        round: 1,
        prompt: 'older',
        response: 'old reply',
        anchor: { kind: 'unloaded', seq: 10 },
      },
      {
        turn: 2,
        round: 2,
        prompt: 'loaded prompt',
        response: 'outline reply',
        anchor: { kind: 'loaded', key: 'u2' },
      },
    ])
  })

  it('drops malformed outline entries without losing navigable turns', () => {
    const outline = [
      { turn: 1, seq: 1, prompt: 'ok', response: '' },
      { turn: 'x', seq: 2 },
      null,
    ]
    expect(mergeTurnRailItems([], outline)).toEqual([
      {
        turn: 1,
        round: 1,
        prompt: 'ok',
        response: '',
        anchor: { kind: 'unloaded', seq: 1 },
      },
    ])
  })

  it('orders the ladder oldest-first even when the outline arrives shuffled', () => {
    const outline = [
      { turn: 3, seq: 30, prompt: 'c', response: '' },
      { turn: 1, seq: 10, prompt: 'a', response: '' },
      { turn: 2, seq: 20, prompt: 'b', response: '' },
    ]
    expect(mergeTurnRailItems([], outline).map(item => item.turn)).toEqual([1, 2, 3])
    expect(mergeTurnRailItems([], outline).map(item => item.round)).toEqual([1, 2, 3])
  })

  it('does not let 插话-only Host turns occupy a 轮次', () => {
    const loaded: readonly TurnNavigationItem[] = [
      { turn: 1, anchorKey: 'u1', prompt: 'open', response: 'ok' },
    ]
    const outline = [
      { turn: 1, seq: 1, prompt: 'open', response: 'ok' },
      { turn: 2, seq: 8, prompt: 'steer text', response: '' },
    ]
    expect(mergeTurnRailItems(loaded, outline, [1, 2]).map(item => item.turn)).toEqual([1])
    expect(mergeTurnRailItems(loaded, outline, [1, 2])[0]?.round).toBe(1)
  })

  it('skips outline rows that have no opening prompt yet', () => {
    const outline = [
      { turn: 1, seq: 1, prompt: '', response: '' },
      { turn: 2, seq: 4, prompt: 'ask', response: '' },
    ]
    expect(mergeTurnRailItems([], outline).map(item => item.turn)).toEqual([2])
    expect(mergeTurnRailItems([], outline)[0]?.round).toBe(1)
  })
})
