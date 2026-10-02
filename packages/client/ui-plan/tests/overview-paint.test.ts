import { beforeEach, describe, expect, it } from 'vitest'
import {
  readOverviewScroll,
  readOverviewSessionUi,
  resetOverviewSessionUiForTests,
  takeOverviewMountPaint,
  writeOverviewSessionUi,
} from '../src/client/overview-paint.ts'

describe('overview-paint session chrome memory', () => {
  beforeEach(() => {
    resetOverviewSessionUiForTests()
  })

  it('remembers tab and scrollTop per Session', () => {
    writeOverviewSessionUi('a', { tab: 'changes', scrollTop: 240 })
    writeOverviewSessionUi('b', { tab: 'canvas', scrollTop: 80 })

    expect(readOverviewSessionUi('a')).toMatchObject({ tab: 'changes', scrollTop: 240 })
    expect(readOverviewSessionUi('b')).toMatchObject({ tab: 'canvas', scrollTop: 80 })
    expect(readOverviewScroll('a', 'changes')).toBe(240)
    expect(readOverviewScroll('a', 'status')).toBe(0)

    const paint = takeOverviewMountPaint('a', undefined)
    expect(paint).toMatchObject({ tab: 'changes', scrollTop: 240 })
  })

  it('keeps independent scroll offsets per tab', () => {
    writeOverviewSessionUi('a', { tab: 'status', scrollTop: 120 })
    writeOverviewSessionUi('a', { tab: 'changes', scrollTop: 360 })
    writeOverviewSessionUi('a', { tab: 'status' })

    expect(readOverviewSessionUi('a')).toMatchObject({ tab: 'status', scrollTop: 120 })
    expect(readOverviewScroll('a', 'changes')).toBe(360)
    expect(readOverviewScroll('a', 'status')).toBe(120)
  })

  it('lineage hop starts child on status at scroll 0 (does not steal parent tab)', () => {
    writeOverviewSessionUi('a', {
      tab: 'changes',
      scrollTop: 200,
      parentId: undefined,
    })

    const paint = takeOverviewMountPaint('child', 'a')
    expect(paint?.tab).toBe('status')
    expect(paint?.scrollTop).toBe(0)
    expect(paint?.parentId).toBe('a')
  })

  it('own chrome wins over lineage hop', () => {
    writeOverviewSessionUi('child', { tab: 'todos', scrollTop: 40, parentId: 'a' })
    writeOverviewSessionUi('a', {
      tab: 'context',
      scrollTop: 100,
      parentId: undefined,
    })

    const paint = takeOverviewMountPaint('child', 'a')
    expect(paint?.tab).toBe('todos')
    expect(paint?.scrollTop).toBe(40)
  })

  it('does not soft-hand unrelated Sessions', () => {
    writeOverviewSessionUi('other', { tab: 'status', scrollTop: 0 })
    writeOverviewSessionUi('a', {
      tab: 'changes',
      scrollTop: 10,
    })

    const paint = takeOverviewMountPaint('other', undefined)
    expect(paint).toMatchObject({ tab: 'status', scrollTop: 0 })
  })

  it('evicts oldest Sessions when the memory cap is exceeded', () => {
    for (let i = 0; i < 50; i++) {
      writeOverviewSessionUi(`s${i}`, {
        tab: 'status',
        scrollTop: i,
      })
    }
    expect(readOverviewSessionUi('s0')).toBeUndefined()
    expect(readOverviewSessionUi('s1')).toBeUndefined()
    expect(readOverviewSessionUi('s49')?.scrollTop).toBe(49)
  })
})
