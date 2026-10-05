import { describe, expect, it } from 'vitest'
import type { TurnNavigationItem } from '@xrkseek/client-runtime/client'
import { mergeTurnRailItems, slideTurnRailWindow } from '../src/client/chat/turn-rail-items.ts'

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

  it('keeps an outline 轮次 when the tail window only has leftover events of that Host turn', () => {
    const loaded: readonly TurnNavigationItem[] = [
      { turn: 4, anchorKey: 'u4', prompt: 'four', response: 'r4' },
      { turn: 5, anchorKey: 'u5', prompt: 'five', response: 'r5' },
    ]
    const outline = [
      { turn: 1, seq: 1, prompt: 'one', response: 'r1' },
      { turn: 2, seq: 10, prompt: 'two', response: 'r2' },
      { turn: 3, seq: 20, prompt: 'three', response: 'r3' },
      { turn: 4, seq: 30, prompt: 'four', response: 'r4' },
      { turn: 5, seq: 40, prompt: 'five', response: 'r5' },
    ]
    // Only turns whose turn/start is in the window; 3 is leftover body.
    const items = mergeTurnRailItems(loaded, outline, [4, 5])
    expect(items.map(item => item.turn)).toEqual([1, 2, 3, 4, 5])
    expect(items.map(item => item.round)).toEqual([1, 2, 3, 4, 5])
    expect(items[1]?.prompt).toBe('two')
    expect(items[2]).toMatchObject({
      turn: 3,
      prompt: 'three',
      response: 'r3',
      anchor: { kind: 'unloaded', seq: 20 },
    })
    expect(items[3]?.prompt).toBe('four')
    expect(items[4]?.prompt).toBe('five')
  })

  it('cold-open tail keeps every 轮次 on the ladder; only the window is loaded', () => {
    const loaded: readonly TurnNavigationItem[] = [
      { turn: 5, anchorKey: 'u5', prompt: 'fifth ask', response: 'working' },
    ]
    const outline = [
      { turn: 1, seq: 1, prompt: 'first', response: 'a' },
      { turn: 2, seq: 10, prompt: 'second', response: 'b' },
      { turn: 3, seq: 20, prompt: 'third', response: 'c' },
      { turn: 4, seq: 30, prompt: 'fourth', response: 'd' },
      { turn: 5, seq: 40, prompt: 'fifth ask', response: 'working' },
    ]
    const tail = mergeTurnRailItems(loaded, outline, [5])
    expect(tail.map(item => ({ turn: item.turn, round: item.round, kind: item.anchor.kind }))).toEqual([
      { turn: 1, round: 1, kind: 'unloaded' },
      { turn: 2, round: 2, kind: 'unloaded' },
      { turn: 3, round: 3, kind: 'unloaded' },
      { turn: 4, round: 4, kind: 'unloaded' },
      { turn: 5, round: 5, kind: 'loaded' },
    ])
  })

  it('load-all upgrades every outline 轮次 to a loaded anchor without renumbering', () => {
    const outline = [
      { turn: 1, seq: 1, prompt: 'first', response: 'a' },
      { turn: 2, seq: 10, prompt: 'second', response: 'b' },
      { turn: 3, seq: 20, prompt: 'third', response: 'c' },
      { turn: 4, seq: 30, prompt: 'fourth', response: 'd' },
      { turn: 5, seq: 40, prompt: 'fifth ask', response: 'working' },
    ]
    const loaded: readonly TurnNavigationItem[] = outline.map(entry => ({
      turn: entry.turn,
      anchorKey: `u${String(entry.turn)}`,
      prompt: entry.prompt,
      response: entry.response,
    }))
    const full = mergeTurnRailItems(loaded, outline, [1, 2, 3, 4, 5])
    expect(full.map(item => item.round)).toEqual([1, 2, 3, 4, 5])
    expect(full.every(item => item.anchor.kind === 'loaded')).toBe(true)
    expect(full[0]?.anchor).toEqual({ kind: 'loaded', key: 'u1' })
    expect(full[4]?.prompt).toBe('fifth ask')
  })

  it('skips outline rows that have no opening prompt yet', () => {
    const outline = [
      { turn: 1, seq: 1, prompt: '', response: '' },
      { turn: 2, seq: 4, prompt: 'ask', response: '' },
    ]
    expect(mergeTurnRailItems([], outline).map(item => item.turn)).toEqual([2])
    expect(mergeTurnRailItems([], outline)[0]?.round).toBe(1)
  })

  it('keeps Face whole-log 轮次 on a loaded tail instead of remapping to 1', () => {
    const outline = [86, 87, 88, 89, 90].map(round => ({
      turn: round,
      seq: round * 10,
      round,
      prompt: `ask ${String(round)}`,
      response: '',
    }))
    const loaded = outline.slice(-3).map(entry => ({
      turn: entry.turn,
      anchorKey: `u${String(entry.turn)}`,
      prompt: entry.prompt,
      response: '',
    }))
    const items = mergeTurnRailItems(loaded, outline, [88, 89, 90])
    expect(items.map(item => item.round)).toEqual([86, 87, 88, 89, 90])
    expect(items.filter(item => item.anchor.kind === 'loaded').map(item => item.round)).toEqual([88, 89, 90])
  })
})

describe('slideTurnRailWindow', () => {
  const ladder = Array.from({ length: 90 }, (_, index) => ({
    turn: index + 1,
    round: index + 1,
    prompt: `ask ${String(index + 1)}`,
    response: '',
    anchor: { kind: 'unloaded' as const, seq: (index + 1) * 10 },
  }))

  it('returns a short session in full (under 10 轮次)', () => {
    expect(slideTurnRailWindow(ladder.slice(0, 3), 3).map(item => item.round)).toEqual([1, 2, 3])
  })

  it('returns a medium session in full (exactly 10 轮次)', () => {
    expect(slideTurnRailWindow(ladder.slice(0, 10), 10).map(item => item.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('shows the newest 10 when the camera sits on a long-session tail', () => {
    const window = slideTurnRailWindow(ladder, 90)
    expect(window.map(item => item.round)).toEqual([81, 82, 83, 84, 85, 86, 87, 88, 89, 90])
  })

  it('pins the session newest as an 11th floor tick when reading mid-ladder', () => {
    const window = slideTurnRailWindow(ladder, 50)
    expect(window.map(item => item.round)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 90])
  })

  it('keeps the oldest 10 and pins newest when the focus is near the head', () => {
    expect(slideTurnRailWindow(ladder, 3).map(item => item.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 90])
  })
})
