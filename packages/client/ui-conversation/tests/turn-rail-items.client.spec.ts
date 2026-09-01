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
        prompt: 'older',
        response: 'old reply',
        anchor: { kind: 'unloaded', seq: 10 },
      },
      {
        turn: 2,
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
        prompt: 'ok',
        response: '',
        anchor: { kind: 'unloaded', seq: 1 },
      },
    ])
  })
})
