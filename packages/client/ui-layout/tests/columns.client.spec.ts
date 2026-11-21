import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, CHAT_FLOOR, clampWidth, computeColumns, DESKTOP_COEXIST_FLOOR,
  DETAILS_DEFAULT, DETAILS_MIN, fitLabeledOrRail, latchWidthBreakpoint, PHONE_EXPAND, PHONE_MAX,
  phoneDrawerWidth, resolveShellTracks,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_EXPAND, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@xrkseek/client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('fitLabeledOrRail', () => {
  it('keeps the preferred labeled width or snaps to the icon rail (no shrink)', () => {
    expect(fitLabeledOrRail(SIDEBAR_DEFAULT, SIDEBAR_DEFAULT)).toBe(SIDEBAR_DEFAULT)
    expect(fitLabeledOrRail(SIDEBAR_DEFAULT, SIDEBAR_DEFAULT + 40)).toBe(SIDEBAR_DEFAULT)
    // Prefer 240 but only 220 fits → rail (never a clipped-label 220 column).
    expect(fitLabeledOrRail(SIDEBAR_DEFAULT, SIDEBAR_MIN)).toBe(SIDEBAR_COLLAPSED)
    expect(fitLabeledOrRail(SIDEBAR_DEFAULT, SIDEBAR_MIN - 1)).toBe(SIDEBAR_COLLAPSED)
    expect(fitLabeledOrRail(SIDEBAR_DEFAULT, 80)).toBe(SIDEBAR_COLLAPSED)
    expect(fitLabeledOrRail(SIDEBAR_MIN, SIDEBAR_MIN)).toBe(SIDEBAR_MIN)
  })
})

describe('coexistence floors (author contract alignment)', () => {
  it('DESKTOP_COEXIST_FLOOR matches XRK_PLUG.layoutFloors.desktopCoexist (880)', () => {
    expect(DESKTOP_COEXIST_FLOOR).toBe(SIDEBAR_DEFAULT + DETAILS_DEFAULT + CHAT_FLOOR)
    expect(DESKTOP_COEXIST_FLOOR).toBe(880)
    expect(CHAT_FLOOR).toBe(280)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 1920 - SIDEBAR_DEFAULT - DETAILS_DEFAULT,
      details: DETAILS_DEFAULT,
    })
  })

  it('closed sidebar keeps its compact rail while closed details contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1))
    expect(cols.sidebar).toBe(420)
    expect(cols.details).toBe(300)
    expect(computeColumns(1920, open(1), open(DETAILS_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: below CENTER_MIN trio softens center before shrinking Overview', () => {
    // Soft preferred details first — Overview must not grow while shrinking.
    const viewport = SIDEBAR_DEFAULT + DETAILS_DEFAULT + CENTER_MIN - 1
    const cols = computeColumns(viewport, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: viewport - SIDEBAR_DEFAULT - DETAILS_DEFAULT,
      details: DETAILS_DEFAULT,
    })
    expect(cols.center).toBeLessThan(CENTER_MIN)
    expect(cols.center).toBeGreaterThanOrEqual(CHAT_FLOOR)
  })

  it('boundary: exactly at the step-1/soft seam', () => {
    const cols = computeColumns(300 + 360 + CENTER_MIN, open(300), open(360))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, details: 360 })
    const one = computeColumns(300 + 360 + CENTER_MIN - 1, open(300), open(360))
    expect(one).toEqual({
      sidebar: 300,
      center: 300 + 360 + CENTER_MIN - 1 - 300 - 360,
      details: 360,
    })
  })

  it('step 3: below DESKTOP_COEXIST_FLOOR shrinks Overview to DETAILS_MIN, keeps labels', () => {
    const cols = computeColumns(
      DESKTOP_COEXIST_FLOOR - 1,
      open(SIDEBAR_DEFAULT),
      open(DETAILS_DEFAULT),
    )
    expect(cols).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: DESKTOP_COEXIST_FLOOR - 1 - SIDEBAR_DEFAULT - DETAILS_MIN,
      details: DETAILS_MIN,
    })
  })

  it('step 4: one pixel under labeled+DETAILS_MIN+CHAT_FLOOR snaps to the icon rail', () => {
    const floor = SIDEBAR_DEFAULT + DETAILS_MIN + CHAT_FLOOR
    expect(computeColumns(floor, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT)).sidebar)
      .toBe(SIDEBAR_DEFAULT)
    const cols = computeColumns(floor - 1, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.sidebar).toBe(SIDEBAR_COLLAPSED)
    expect(cols.details).toBe(DETAILS_MIN)
  })

  it('sidebar and details are monotonic as the frame shrinks (open + Overview)', () => {
    let prevS = Number.POSITIVE_INFINITY
    let prevD = Number.POSITIVE_INFINITY
    for (let vp = 1600; vp >= 500; vp -= 1) {
      const { sidebar, details } = computeColumns(vp, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
      expect(sidebar).toBeLessThanOrEqual(prevS)
      if (details > 0 && prevD > 0) expect(details).toBeLessThanOrEqual(prevD)
      prevS = sidebar
      if (details > 0) prevD = details
      else prevD = 0
    }
  })

  it('closing Overview never shrinks a labeled left column that still fits', () => {
    for (let vp = 1600; vp >= SIDEBAR_DEFAULT + CHAT_FLOOR; vp -= 1) {
      const withOverview = computeColumns(vp, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
      const without = computeColumns(vp, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
      expect(without.sidebar).toBeGreaterThanOrEqual(withOverview.sidebar)
    }
  })

  it('closed details: preferred width or rail — never a squeezed labeled column', () => {
    const fits = computeColumns(SIDEBAR_DEFAULT + CENTER_MIN, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(fits).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      details: 0,
    })
    // Soft labeled keeps preferred width down to CHAT_FLOOR (no premature rail).
    const soft = computeColumns(SIDEBAR_DEFAULT + CHAT_FLOOR, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(soft).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CHAT_FLOOR,
      details: 0,
    })
    const tight = computeColumns(SIDEBAR_DEFAULT + CHAT_FLOOR - 1, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(tight).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: SIDEBAR_DEFAULT + CHAT_FLOOR - 1 - SIDEBAR_COLLAPSED,
      details: 0,
    })
  })

  it('tracks always sum to the viewport', () => {
    for (let vp = 400; vp <= 1600; vp += 13) {
      for (const details of [0, DETAILS_DEFAULT]) {
        const cols = computeColumns(vp, open(SIDEBAR_DEFAULT), details)
        expect(cols.sidebar + cols.center + cols.details).toBe(vp)
      }
    }
  })

  it('never paints an open preference other than preferred width or the icon rail', () => {
    for (let vp = 500; vp <= 1300; vp += 17) {
      const cols = computeColumns(vp, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
      const ok = cols.sidebar === SIDEBAR_COLLAPSED || cols.sidebar === SIDEBAR_DEFAULT
      expect(ok).toBe(true)
    }
  })

  it('step 4: Overview stays open down to CHAT_FLOOR before yielding', () => {
    // Soft preferred details (closed sidebar = rail) while center softens.
    const softPreferred = computeColumns(
      SIDEBAR_COLLAPSED + DETAILS_DEFAULT + CHAT_FLOOR,
      closed(300),
      open(DETAILS_DEFAULT),
    )
    expect(softPreferred).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: CHAT_FLOOR,
      details: DETAILS_DEFAULT,
    })
    // Below preferred soft floor — Overview shrinks to DETAILS_MIN (rail already).
    const softMin = computeColumns(
      SIDEBAR_COLLAPSED + DETAILS_MIN + CHAT_FLOOR,
      closed(300),
      open(DETAILS_DEFAULT),
    )
    expect(softMin).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: CHAT_FLOOR,
      details: DETAILS_MIN,
    })
    // Below CHAT_FLOOR trio — Overview yields.
    const starved = computeColumns(
      SIDEBAR_COLLAPSED + DETAILS_MIN + CHAT_FLOOR - 1,
      closed(300),
      open(DETAILS_DEFAULT),
    )
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: Math.max(0, starved.center),
      details: 0,
    })
    expect(starved.center).toBe(
      Math.max(0, SIDEBAR_COLLAPSED + DETAILS_MIN + CHAT_FLOOR - 1 - SIDEBAR_COLLAPSED),
    )
  })

  it('tiny viewport: Overview yields, sidebar rails, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: Math.max(0, 400 - SIDEBAR_COLLAPSED),
      details: 0,
    })
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.details).toBeGreaterThan(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed below CHAT_FLOOR trio: Overview yields, center takes the rest', () => {
    const vp = SIDEBAR_COLLAPSED + DETAILS_MIN + CHAT_FLOOR - 1
    expect(computeColumns(vp, closed(300), open(DETAILS_DEFAULT)))
      .toEqual({
        sidebar: SIDEBAR_COLLAPSED,
        center: Math.max(0, vp - SIDEBAR_COLLAPSED),
        details: 0,
      })
  })
})

describe('desktop coexistence', () => {
  it('DESKTOP_COEXIST_FLOOR keeps default sidebar + Overview + chat strip', () => {
    expect(DESKTOP_COEXIST_FLOOR).toBe(SIDEBAR_DEFAULT + DETAILS_DEFAULT + CHAT_FLOOR)
    const cols = computeColumns(DESKTOP_COEXIST_FLOOR, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.details).toBe(DETAILS_DEFAULT)
    expect(cols.center).toBe(CHAT_FLOOR)
  })

  it('wide frame keeps preferred trio without phone chrome', () => {
    const solved = computeColumns(1400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(resolveShellTracks(1400, solved, false)).toEqual({ phone: false, tracks: solved })
    expect(solved.details).toBe(DETAILS_DEFAULT)
    expect(solved.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('latchWidthBreakpoint', () => {
  it('enters below enter, stays until exit, then clears', () => {
    expect(latchWidthBreakpoint(false, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_EXPAND)).toBe(false)
    expect(latchWidthBreakpoint(false, SIDEBAR_AUTO_COLLAPSE - 1, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_EXPAND)).toBe(true)
    expect(latchWidthBreakpoint(true, SIDEBAR_AUTO_EXPAND - 1, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_EXPAND)).toBe(true)
    expect(latchWidthBreakpoint(true, SIDEBAR_AUTO_EXPAND, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_AUTO_EXPAND)).toBe(false)
    expect(latchWidthBreakpoint(true, PHONE_EXPAND - 1, PHONE_MAX, PHONE_EXPAND)).toBe(true)
    expect(latchWidthBreakpoint(true, PHONE_EXPAND, PHONE_MAX, PHONE_EXPAND)).toBe(false)
  })
})

describe('resolveShellTracks / phoneDrawerWidth', () => {
  it('phone zeros in-flow sidebar and details tracks', () => {
    const solved = computeColumns(390, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(solved.details).toBe(0)
    expect(solved.sidebar).toBe(SIDEBAR_COLLAPSED)
    expect(resolveShellTracks(390, solved, true)).toEqual({
      phone: true,
      tracks: { sidebar: 0, center: 390, details: 0 },
    })
  })

  it('tablet and desktop keep the concession solve', () => {
    const tablet = computeColumns(980, closed(300), closed(360))
    expect(resolveShellTracks(980, tablet, false)).toEqual({ phone: false, tracks: tablet })
    const desktop = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(resolveShellTracks(1920, desktop, false)).toEqual({ phone: false, tracks: desktop })
  })

  it('phone flag is caller-owned (workbench-squeezed frame stays desktop)', () => {
    const squeezed = computeColumns(600, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(resolveShellTracks(600, squeezed, false)).toEqual({ phone: false, tracks: squeezed })
    // 600 < rail+DETAILS_MIN+CHAT_FLOOR (636) → Overview yields; chat remains.
    expect(squeezed.details).toBe(0)
    expect(squeezed.center).toBeGreaterThan(0)
    expect(resolveShellTracks(600, squeezed, true).phone).toBe(true)
  })

  it('phoneDrawerWidth prefers the contract default and leaves a scrim gap', () => {
    expect(phoneDrawerWidth(390)).toBe(SIDEBAR_DEFAULT)
    expect(phoneDrawerWidth(280)).toBe(280 - 48)
    expect(phoneDrawerWidth(200)).toBe(SIDEBAR_MIN)
  })
})
