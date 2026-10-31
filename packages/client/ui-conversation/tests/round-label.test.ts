import { describe, expect, it } from 'vitest'
import {
  openerKeysFromRail, roundLabelLocaleKey, userRoundLabelKind,
} from '../src/client/chat/round-label.ts'

describe('round-label', () => {
  const openers = new Map([[1, 'user:opener'], [2, 'user:second']])

  it('marks the rail opener as 第 N 轮', () => {
    expect(userRoundLabelKind('user:opener', 1, openers, 'user')).toBe('turn')
    expect(roundLabelLocaleKey('turn')).toBe('chat.turnNavigation.turn')
  })

  it('marks a same-turn non-opener as 插话 even when kind stayed user', () => {
    expect(userRoundLabelKind('user:steer-lost-claim', 1, openers, 'user')).toBe('steer')
    expect(roundLabelLocaleKey('steer')).toBe('chat.turnNavigation.steer')
  })

  it('suppresses round chrome on auto-continue 继续', () => {
    expect(userRoundLabelKind('user:continue', 1, openers, 'auto-continue')).toBeNull()
  })

  it('keeps opener wording while the rail has not resolved the turn yet', () => {
    expect(userRoundLabelKind('user:fresh', 9, openers, 'user')).toBe('turn')
    expect(userRoundLabelKind('user:fresh', undefined, openers, 'user')).toBe('turn')
  })

  it('indexes loaded rail anchors only', () => {
    expect(openerKeysFromRail([
      { turn: 1, anchor: { kind: 'loaded', key: 'user:a' } },
      { turn: 2, anchor: { kind: 'unloaded', key: 'ignored' } },
      { turn: 3, anchor: { kind: 'loaded' } },
    ])).toEqual(new Map([[1, 'user:a']]))
  })
})
