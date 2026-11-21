/**
 * Author-facing layout floor contract. Must stay aligned with Host
 * `DESKTOP_COEXIST_FLOOR` / `CHAT_FLOOR` (ui-layout columns.ts) and the
 * independent workbench defaults (better-sidebar layout-push).
 */
import { describe, expect, it } from 'vitest'
import {
  XRK_PLUG,
  xrkPlugFitWorkbenchHeight,
  xrkPlugFitWorkbenchWidth,
  xrkPlugPushFloor,
  xrkPlugShellOccupied,
  xrkPlugWorkbenchRoom,
} from '../src/index.ts'

describe('XRK_PLUG layout floors', () => {
  it('lists every Host process kind (incl. hooks)', () => {
    expect([...XRK_PLUG.processKinds]).toEqual([
      'tools',
      'prompt',
      'commands',
      'hooks',
      'host',
      'channel',
      'policy',
      'llm',
    ])
  })

  it('keeps coexistence numbers pinned to the documented 880 / 280 contract', () => {
    expect(XRK_PLUG.layoutFloors.desktopCoexist).toBe(880)
    expect(XRK_PLUG.layoutFloors.chatStrip).toBe(280)
    expect(XRK_PLUG.layoutInsetCssVars.sidebar).toBe('--xrk-layout-inset-sidebar')
    expect(XRK_PLUG.layoutInsetCssVars.details).toBe('--xrk-layout-inset-details')
    expect(XRK_PLUG.workbenchCssVars.width).toBe('--xrkh-workbench-width')
  })

  it('lists every Host-discoverable process kind including hooks', () => {
    expect(XRK_PLUG.processKinds).toEqual([
      'tools',
      'prompt',
      'commands',
      'hooks',
      'host',
      'channel',
      'policy',
      'llm',
    ])
  })

  it('xrkPlugPushFloor is max(base, shellOccupied + chatStrip)', () => {
    expect(xrkPlugPushFloor()).toBe(880)
    expect(xrkPlugPushFloor({ shellOccupied: 700 })).toBe(980)
    expect(xrkPlugPushFloor({ shellOccupied: 100 })).toBe(880)
    expect(xrkPlugPushFloor({ baseFloor: 500, chatStrip: 50, shellOccupied: 400 })).toBe(500)
    expect(xrkPlugPushFloor({ baseFloor: 500, chatStrip: 50, shellOccupied: 480 })).toBe(530)
  })

  it('xrkPlugShellOccupied sums rail + Overview', () => {
    expect(xrkPlugShellOccupied({ sidebar: 240, details: 360 })).toBe(600)
    expect(xrkPlugShellOccupied({})).toBe(0)
    expect(xrkPlugShellOccupied({ sidebar: Number.NaN, details: -3 })).toBe(0)
  })

  it('exposes layout attrs / keyboard / phone floor for authors', () => {
    expect(XRK_PLUG.keyboardInsetCss).toBe('--xrk-keyboard-inset')
    expect(XRK_PLUG.layoutAttrs.phone).toBe('data-xrk-layout-phone')
    expect(XRK_PLUG.phoneMaxPx).toBe(768)
    expect(XRK_PLUG.layoutFloors.workbenchPanelMin).toBe(280)
  })

  it('xrkPlugWorkbenchRoom / fit width / height follow first-party policy', () => {
    expect(xrkPlugWorkbenchRoom(1200, 600)).toBe(320)
    expect(xrkPlugFitWorkbenchWidth(400, 320, true)).toBe(320)
    expect(xrkPlugFitWorkbenchWidth(400, 200, true)).toBe(0)
    expect(xrkPlugFitWorkbenchWidth(400, 400, false)).toBe(0)
    expect(xrkPlugFitWorkbenchHeight(500, 800, true)).toBe(500)
    expect(xrkPlugFitWorkbenchHeight(600, 800, true)).toBe(520)
    expect(xrkPlugFitWorkbenchHeight(400, 800, false)).toBe(0)
  })
})
