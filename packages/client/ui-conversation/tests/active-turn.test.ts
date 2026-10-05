import { describe, expect, it } from 'vitest'
import { resolveActiveTurn } from '../src/client/chat/active-turn.ts'

describe('resolveActiveTurn', () => {
  it('pins the newest loaded turn at the flow floor', () => {
    expect(resolveActiveTurn({
      readingTurn: 1,
      offeredTurns: [1, 2, 3],
      loadedTurns: [1, 2, 3],
      atFlowFloor: true,
    })).toBe(3)
  })

  it('does not keep Turn 1 when the floor is the latest loaded round', () => {
    expect(resolveActiveTurn({
      readingTurn: null,
      offeredTurns: [1, 2, 7],
      loadedTurns: [1, 2, 7],
      atFlowFloor: true,
    })).toBe(7)
  })

  it('does not label a tail page of 轮次 1 as the newest outline tick', () => {
    expect(resolveActiveTurn({
      readingTurn: 1,
      offeredTurns: [1, 2, 3, 4, 5],
      loadedTurns: [1],
      atFlowFloor: true,
    })).toBe(1)
  })

  it('keeps a cold-open tail of 轮次 5 at 5 when that is what is loaded', () => {
    expect(resolveActiveTurn({
      readingTurn: 5,
      offeredTurns: [1, 2, 3, 4, 5],
      loadedTurns: [5],
      atFlowFloor: true,
    })).toBe(5)
  })

  it('follows the reading line among offered turns', () => {
    expect(resolveActiveTurn({
      readingTurn: 2,
      offeredTurns: [1, 2, 4],
      loadedTurns: [1, 2, 4],
      atFlowFloor: false,
    })).toBe(2)
    expect(resolveActiveTurn({
      readingTurn: 3,
      offeredTurns: [1, 2, 4],
      loadedTurns: [1, 2, 4],
      atFlowFloor: false,
    })).toBe(2)
  })

  it('uses the first loaded turn when the line has not hit a row yet', () => {
    expect(resolveActiveTurn({
      readingTurn: null,
      offeredTurns: [1, 2, 5],
      loadedTurns: [5],
      atFlowFloor: false,
    })).toBe(5)
  })
})
