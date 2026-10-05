import { describe, expect, it } from 'vitest'
import { resolveActiveTurn } from '../src/client/chat/active-turn.ts'

describe('resolveActiveTurn', () => {
  it('pins the newest offered turn at the flow floor', () => {
    expect(resolveActiveTurn({
      readingTurn: 1,
      offeredTurns: [1, 2, 3],
      atFlowFloor: true,
    })).toBe(3)
  })

  it('does not keep Turn 1 when the floor is the latest round', () => {
    expect(resolveActiveTurn({
      readingTurn: null,
      offeredTurns: [1, 2, 7],
      atFlowFloor: true,
    })).toBe(7)
  })

  it('follows the reading line among offered turns', () => {
    expect(resolveActiveTurn({
      readingTurn: 2,
      offeredTurns: [1, 2, 4],
      atFlowFloor: false,
    })).toBe(2)
    expect(resolveActiveTurn({
      readingTurn: 3,
      offeredTurns: [1, 2, 4],
      atFlowFloor: false,
    })).toBe(2)
  })

  it('uses the first offered turn when the line has not hit a row yet', () => {
    expect(resolveActiveTurn({
      readingTurn: null,
      offeredTurns: [1, 2],
      atFlowFloor: false,
    })).toBe(1)
  })
})
