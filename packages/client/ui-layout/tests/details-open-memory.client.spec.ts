// @vitest-environment jsdom
/**
 * Per-Session Overview chrome memory: open bit + width, localStorage reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DETAILS_DEFAULT } from '@xrkseek/client-ui-layout/src/client/columns.ts'
import {
  readDetailsChrome,
  rememberDetailsOpen,
  resetDetailsOpenMemoryForTests,
  selectDetailsOpenMemory,
} from '@xrkseek/client-ui-layout/src/client/details-open-memory.ts'

const KEY = 'xrk.layout.overview.v1'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetDetailsOpenMemoryForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('details-open-memory', () => {
  it('remembers open + width per Session and rehydrates after reset', async () => {
    rememberDetailsOpen('a', true, 480)
    rememberDetailsOpen('b', false, 400)
    expect(readDetailsChrome('a')).toEqual({ open: true, width: 480 })
    expect(readDetailsChrome('b')).toEqual({ open: false, width: 400 })

    await vi.advanceTimersByTimeAsync(600)
    const raw = localStorage.getItem(KEY)
    expect(raw).not.toBeNull()

    // Simulate a fresh module lifetime: clear the in-memory map, keep storage.
    resetDetailsOpenMemoryForTests({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    // Put the document back, then read (hydrate on demand).
    localStorage.setItem(KEY, raw!)
    expect(readDetailsChrome('a')).toEqual({ open: true, width: 480 })
    expect(readDetailsChrome('b')).toEqual({ open: false, width: 400 })
  })

  it('select restores a previously open Session after a closed visit', () => {
    rememberDetailsOpen('a', true, 480)
    const leave = selectDetailsOpenMemory({
      fromId: 'a',
      fromParentId: undefined,
      toId: 'b',
      toParentId: undefined,
      openNow: true,
      widthNow: 480,
    })
    expect(leave).toEqual({ action: 'close', width: DETAILS_DEFAULT })

    const back = selectDetailsOpenMemory({
      fromId: 'b',
      fromParentId: undefined,
      toId: 'a',
      toParentId: undefined,
      openNow: false,
      widthNow: DETAILS_DEFAULT,
    })
    expect(back).toEqual({ action: 'open', width: 480 })
  })

  it('lineage hop keeps an open column and inherits width', () => {
    const hop = selectDetailsOpenMemory({
      fromId: 'parent',
      fromParentId: undefined,
      toId: 'child',
      toParentId: 'parent',
      openNow: true,
      widthNow: 500,
    })
    expect(hop.action).toBe('keep')
    expect(hop.width).toBe(500)
    expect(readDetailsChrome('child')).toEqual({ open: true, width: 500 })
  })
})
