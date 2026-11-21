import { describe, expect, it } from 'vitest'
import {
  DELEGATE_ARROW_COL_PX,
  DELEGATE_GAP_PHONE_PX,
  DELEGATE_GAP_PX,
  DELEGATE_PEEK_PAD_RATIO,
  DELEGATE_PEEK_PAD_RATIO_PHONE,
  DELEGATE_STAGE_CAP_PHONE_PX,
  DELEGATE_STAGE_CAP_PX,
  resolveDelegatePairGeometry,
} from '../src/client/delegate-pair-geometry.ts'

describe('resolveDelegatePairGeometry', () => {
  it('splits the row into equal seat tracks (no 1.35fr left bias)', () => {
    const g = resolveDelegatePairGeometry({ containerWidth: 360, stackCount: 1 })
    expect(g.gridTemplateColumns).toBe('minmax(0, 1fr) auto minmax(0, 1fr)')
    const expected = (360 - DELEGATE_ARROW_COL_PX - 2 * DELEGATE_GAP_PX) / 2
    expect(g.seatTrackPx).toBeCloseTo(expected, 6)
  })

  it('solo lead: zero left pad and isometric stage capped for both seats', () => {
    const g = resolveDelegatePairGeometry({ containerWidth: 400, stackCount: 1 })
    expect(g.leftPadPx).toBe(0)
    expect(g.stagePx).toBe(DELEGATE_STAGE_CAP_PX[1])
    // Lead and 被委派方 share one number — narrowing later must shrink both.
    expect(g.stagePx).toBeLessThanOrEqual(g.seatTrackPx)
  })

  it('narrow Overview shrinks both seats together (not only the right ball)', () => {
    const wide = resolveDelegatePairGeometry({ containerWidth: 420, stackCount: 1 })
    const narrow = resolveDelegatePairGeometry({ containerWidth: 220, stackCount: 1 })
    expect(wide.stagePx).toBe(DELEGATE_STAGE_CAP_PX[1])
    expect(narrow.stagePx).toBeLessThan(wide.stagePx)
    // Equal tracks ⇒ stage cannot exceed either seat.
    expect(narrow.stagePx).toBeCloseTo(narrow.seatTrackPx, 6)
    expect(narrow.leftPadPx).toBe(0)
  })

  it('stacked parents compress stage inside equal tracks — pad only when peeks exist', () => {
    const solo = resolveDelegatePairGeometry({ containerWidth: 360, stackCount: 1 })
    const stacked = resolveDelegatePairGeometry({ containerWidth: 360, stackCount: 2 })
    expect(solo.leftPadPx).toBe(0)
    expect(stacked.leftPadPx).toBeGreaterThan(0)
    expect(stacked.leftPadPx).toBeCloseTo(stacked.stagePx * DELEGATE_PEEK_PAD_RATIO, 6)
    expect(stacked.stagePx).toBeLessThanOrEqual(DELEGATE_STAGE_CAP_PX[2])
    expect(stacked.seatTrackPx).toBeCloseTo(solo.seatTrackPx, 6)
    // Peek pad + stage still fit the left equal track (no invented wider column).
    expect(stacked.stagePx + stacked.leftPadPx).toBeLessThanOrEqual(stacked.seatTrackPx + 1e-6)
  })

  it('phone density uses tighter caps/gaps but keeps equal tracks + solo zero pad', () => {
    const g = resolveDelegatePairGeometry({
      containerWidth: 360,
      stackCount: 1,
      phone: true,
    })
    expect(g.leftPadPx).toBe(0)
    expect(g.stagePx).toBe(DELEGATE_STAGE_CAP_PHONE_PX[1])
    const expected = (360 - DELEGATE_ARROW_COL_PX - 2 * DELEGATE_GAP_PHONE_PX) / 2
    expect(g.seatTrackPx).toBeCloseTo(expected, 6)
  })

  it('phone stacked peeks use the phone pad ratio inside the same equal track', () => {
    const g = resolveDelegatePairGeometry({
      containerWidth: 320,
      stackCount: 3,
      phone: true,
    })
    expect(g.leftPadPx).toBeCloseTo(g.stagePx * DELEGATE_PEEK_PAD_RATIO_PHONE, 6)
    expect(g.stagePx).toBeLessThanOrEqual(DELEGATE_STAGE_CAP_PHONE_PX[3])
    expect(g.stagePx + g.leftPadPx).toBeLessThanOrEqual(g.seatTrackPx + 1e-6)
  })

  it('arrow↔card gaps stay symmetric: equal tracks imply equal outer remainder', () => {
    // Visual: seats hug the arrow; leftover in each track is (track - stage)/2
    // on the outer side only when stage < track — same on L and R.
    const g = resolveDelegatePairGeometry({ containerWidth: 400, stackCount: 1 })
    const outer = g.seatTrackPx - g.stagePx
    expect(outer).toBeGreaterThanOrEqual(0)
    // Both seats share stagePx ⇒ outer leftovers are identical.
    expect(g.seatTrackPx - g.stagePx).toBeCloseTo(outer, 6)
  })
})
