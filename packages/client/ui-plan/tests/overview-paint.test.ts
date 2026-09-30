import { beforeEach, describe, expect, it } from 'vitest'
import {
  readOverviewScroll,
  readOverviewSessionUi,
  resetOverviewSessionUiForTests,
  takeOverviewMountPaint,
  writeOverviewSessionUi,
} from '../src/client/overview-paint.ts'
import type { PreviewTabLoad, SessionStatusView } from '../src/client/preview-load.ts'

const emptyLoad = (): PreviewTabLoad => ({ plan: null, office: null, status: null })

const statusLoad = (sessionId: string): PreviewTabLoad => ({
  plan: null,
  office: null,
  status: { sessionId } as SessionStatusView,
})

describe('overview-paint session chrome memory', () => {
  beforeEach(() => {
    resetOverviewSessionUiForTests()
  })

  it('remembers tab and scrollTop per Session', () => {
    writeOverviewSessionUi('a', { tab: 'changes', scrollTop: 240, loaded: statusLoad('a') })
    writeOverviewSessionUi('b', { tab: 'canvas', scrollTop: 80, loaded: statusLoad('b') })

    expect(readOverviewSessionUi('a')).toMatchObject({ tab: 'changes', scrollTop: 240 })
    expect(readOverviewSessionUi('b')).toMatchObject({ tab: 'canvas', scrollTop: 80 })
    expect(readOverviewScroll('a', 'changes')).toBe(240)
    expect(readOverviewScroll('a', 'status')).toBe(0)

    const paint = takeOverviewMountPaint('a', undefined)
    expect(paint).toMatchObject({ tab: 'changes', scrollTop: 240 })
  })

  it('keeps independent scroll offsets per tab', () => {
    writeOverviewSessionUi('a', { tab: 'status', scrollTop: 120, loaded: statusLoad('a') })
    writeOverviewSessionUi('a', { tab: 'changes', scrollTop: 360 })
    writeOverviewSessionUi('a', { tab: 'status' })

    expect(readOverviewSessionUi('a')).toMatchObject({ tab: 'status', scrollTop: 120 })
    expect(readOverviewScroll('a', 'changes')).toBe(360)
    expect(readOverviewScroll('a', 'status')).toBe(120)
  })

  it('soft-hands parent↔child loaded only; own tab/scroll win', () => {
    writeOverviewSessionUi('child', { tab: 'todos', scrollTop: 40, parentId: 'a', loaded: emptyLoad() })
    writeOverviewSessionUi('a', {
      tab: 'context',
      scrollTop: 100,
      parentId: undefined,
      loaded: statusLoad('a'),
    })

    const paint = takeOverviewMountPaint('child', 'a')
    expect(paint?.tab).toBe('todos')
    expect(paint?.scrollTop).toBe(40)
    expect(paint?.loaded?.status?.sessionId).toBe('a')
  })

  it('new soft-hop child starts on status at scroll 0 (does not steal parent tab)', () => {
    writeOverviewSessionUi('a', {
      tab: 'changes',
      scrollTop: 200,
      loaded: statusLoad('a'),
    })

    const paint = takeOverviewMountPaint('child', 'a')
    expect(paint?.tab).toBe('status')
    expect(paint?.scrollTop).toBe(0)
    expect(paint?.loaded?.status?.sessionId).toBe('a')
  })

  it('does not soft-hand unrelated Sessions', () => {
    writeOverviewSessionUi('other', { tab: 'status', scrollTop: 0, loaded: emptyLoad() })
    writeOverviewSessionUi('a', {
      tab: 'changes',
      scrollTop: 10,
      loaded: statusLoad('a'),
    })

    const paint = takeOverviewMountPaint('other', undefined)
    expect(paint?.loaded?.status).toBeNull()
    expect(paint?.tab).toBe('status')
  })

  it('evicts oldest Sessions when the memory cap is exceeded', () => {
    for (let i = 0; i < 50; i++) {
      writeOverviewSessionUi(`s${i}`, {
        tab: 'status',
        scrollTop: i,
        loaded: statusLoad(`s${i}`),
      })
    }
    expect(readOverviewSessionUi('s0')).toBeUndefined()
    expect(readOverviewSessionUi('s1')).toBeUndefined()
    expect(readOverviewSessionUi('s49')?.scrollTop).toBe(49)
  })
})
