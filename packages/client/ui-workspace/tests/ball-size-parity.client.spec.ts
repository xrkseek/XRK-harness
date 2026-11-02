import { describe, expect, it } from 'vitest'
import {
  BALL_SIZE_MAX,
  BALL_SIZE_MIN,
  BALL_SIZE_STEP,
} from '../src/client/dressing-scope.ts'
import {
  DEFAULT_PRESENCE_SIZE,
  PRESENCE_SIZE_MAX,
  PRESENCE_SIZE_MIN,
  PRESENCE_SIZE_STEP,
  parsePresenceSize,
} from '../../ui-plan/src/presence-settings.ts'

/**
 * Ball size has exactly one vocabulary across two Settings surfaces (Team roster
 * writes `member.appearance.size`, Settings writes `ui-presence.size`) and the
 * Host validator. They are separate constants on purpose — a client package
 * cannot import the other's internals without a peer cycle — so the only thing
 * keeping them honest is this spec.
 */
describe('ball size parity', () => {
  it('both client surfaces use the same trim range and step', () => {
    expect(BALL_SIZE_MIN).toBe(PRESENCE_SIZE_MIN)
    expect(BALL_SIZE_MAX).toBe(PRESENCE_SIZE_MAX)
    expect(BALL_SIZE_STEP).toBe(PRESENCE_SIZE_STEP)
  })

  it('the trim is a trim: ±20% around 100%', () => {
    expect(PRESENCE_SIZE_MIN).toBe(0.8)
    expect(PRESENCE_SIZE_MAX).toBe(1.2)
    expect(DEFAULT_PRESENCE_SIZE).toBe(1)
  })

  it('parse quantises onto the step grid and rejects the old zoom range', () => {
    expect(parsePresenceSize(1)).toBe(1)
    expect(parsePresenceSize(1.2)).toBe(1.2)
    expect(parsePresenceSize(0.8)).toBe(0.8)
    /* 0.81 snaps to the 0.02 grid, not to a tenth. */
    expect(parsePresenceSize(0.81)).toBe(0.82)
    expect(parsePresenceSize(1.19)).toBe(1.2)
    /* Values from the retired 0.6–1.6 slider fall back to 1, never a stray size. */
    expect(parsePresenceSize(0.6)).toBe(1)
    expect(parsePresenceSize(1.6)).toBe(1)
    expect(parsePresenceSize(Number.NaN)).toBe(1)
    expect(parsePresenceSize('nope')).toBe(1)
  })

  it('never leaks float dust into Host storage', () => {
    for (let v = 0.8; v <= 1.2001; v += 0.02) {
      const parsed = parsePresenceSize(v)
      expect(String(parsed)).toMatch(/^\d(\.\d{1,3})?$/)
    }
  })
})
