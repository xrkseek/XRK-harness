// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import {
  LONG_PRESS_CANCEL_MOVE_COARSE_PX,
  LONG_PRESS_REORDER_MS,
  dropHalfFromClientY,
  hitTestReorderTarget,
  prefersHtml5Reorder,
  useLongPressReorder,
} from '../src/long-press-reorder.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function stubPointer(kind: 'fine' | 'coarse'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'fine'
      ? query.includes('pointer: fine')
      : query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function Harness({
  enabled = true,
  onStart,
  onMove,
  onEnd,
}: {
  enabled?: boolean
  onStart: () => void
  onMove: (x: number, y: number) => void
  onEnd: () => void
}) {
  const g = useLongPressReorder(enabled, { onStart, onMove, onEnd })
  return (
    <div
      data-testid="row"
      ref={g.rowRef as RefObject<HTMLDivElement | null>}
      draggable={g.draggable}
      data-armed={g.armed ? '1' : '0'}
      data-html5={g.useHtml5 ? '1' : '0'}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', 'x')
        g.onHtml5DragStart?.()
      }}
      onDragEnd={g.onHtml5DragEnd}
    >
      row
    </div>
  )
}

describe('dropHalfFromClientY', () => {
  it('splits on the vertical midpoint', () => {
    const rect = { top: 100, height: 40 }
    expect(dropHalfFromClientY(110, rect)).toBe('before')
    expect(dropHalfFromClientY(130, rect)).toBe('after')
  })
})

describe('prefersHtml5Reorder', () => {
  it('is true for fine pointers and false for coarse', () => {
    stubPointer('fine')
    expect(prefersHtml5Reorder()).toBe(true)
    stubPointer('coarse')
    expect(prefersHtml5Reorder()).toBe(false)
  })

  it('prefers long-press when coarse is present even if fine also matches', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: fine') || query.includes('pointer: coarse'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    expect(prefersHtml5Reorder()).toBe(false)
  })
})

describe('useLongPressReorder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('desktop (fine): HTML5 drag only — no long-press timer path', () => {
    stubPointer('fine')
    const onStart = vi.fn()
    const onMove = vi.fn()
    const onEnd = vi.fn()
    render(<Harness onStart={onStart} onMove={onMove} onEnd={onEnd} />)
    const row = screen.getByTestId('row')
    expect(row.getAttribute('data-html5')).toBe('1')
    expect(row.getAttribute('draggable')).toBe('true')

    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_REORDER_MS + 50) })
    expect(onStart).not.toHaveBeenCalled()

    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    fireEvent.dragStart(row, { dataTransfer })
    expect(onStart).toHaveBeenCalledOnce()
    fireEvent.dragEnd(row)
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('phone (coarse): arms via ref so move/up work before paint', () => {
    stubPointer('coarse')
    const onStart = vi.fn()
    const onMove = vi.fn()
    const onEnd = vi.fn()
    function TouchHarness() {
      const g = useLongPressReorder(true, { onStart, onMove, onEnd })
      return (
        <div
          data-testid="row"
          ref={g.rowRef as RefObject<HTMLDivElement | null>}
          draggable={g.draggable}
          data-armed={g.armed ? '1' : '0'}
          data-html5={g.useHtml5 ? '1' : '0'}
          style={g.touchAction === undefined ? undefined : { touchAction: g.touchAction }}
          onPointerDown={g.onPointerDown}
          onPointerMove={g.onPointerMove}
          onPointerUp={g.onPointerUp}
          onPointerCancel={g.onPointerCancel}
        >
          row
        </div>
      )
    }
    render(<TouchHarness />)
    const row = screen.getByTestId('row')
    expect(row.getAttribute('data-html5')).toBe('0')
    expect(row.getAttribute('draggable')).toBe('false')
    // Idle: pan-y so the list still scrolls from a row.
    expect(row.style.touchAction).toBe('pan-y')

    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 7 })
    expect(row.style.touchAction).toBe('pan-y')
    act(() => { vi.advanceTimersByTime(LONG_PRESS_REORDER_MS) })
    expect(onStart).toHaveBeenCalledOnce()
    // Only after arm do we claim the finger.
    expect(row.style.touchAction).toBe('none')

    // Critical: move must work off armedRef even if paint lagged.
    fireEvent.pointerMove(row, { clientX: 40, clientY: 80, pointerId: 7 })
    expect(onMove).toHaveBeenCalledWith(40, 80)

    fireEvent.pointerUp(row, { pointerId: 7 })
    expect(onEnd).toHaveBeenCalledOnce()
    expect(row.style.touchAction).toBe('pan-y')
  })

  it('phone: scroll jitter before the hold cancels the timer', () => {
    stubPointer('coarse')
    const onStart = vi.fn()
    render(
      <Harness onStart={onStart} onMove={vi.fn()} onEnd={vi.fn()} />,
    )
    const row = screen.getByTestId('row')
    fireEvent.pointerDown(row, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(row, {
      clientX: 0,
      clientY: LONG_PRESS_CANCEL_MOVE_COARSE_PX + 1,
      pointerId: 1,
    })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_REORDER_MS + 20) })
    expect(onStart).not.toHaveBeenCalled()
  })

  it('phone: scroll-parent scroll during the hold cancels arming', () => {
    stubPointer('coarse')
    const onStart = vi.fn()
    function ScrollHarness() {
      const g = useLongPressReorder(true, { onStart, onMove: vi.fn(), onEnd: vi.fn() })
      return (
        <div
          data-testid="scroller"
          style={{ overflowY: 'auto', height: 80 }}
          ref={(node) => {
            if (node === null) return
            Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => 400 })
            Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => 80 })
          }}
        >
          <div
            data-testid="row"
            ref={g.rowRef as RefObject<HTMLDivElement | null>}
            onPointerDown={g.onPointerDown}
          >
            row
          </div>
        </div>
      )
    }
    render(<ScrollHarness />)
    const row = screen.getByTestId('row')
    const scroller = screen.getByTestId('scroller')
    fireEvent.pointerDown(row, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.scroll(scroller)
    act(() => { vi.advanceTimersByTime(LONG_PRESS_REORDER_MS + 20) })
    expect(onStart).not.toHaveBeenCalled()
  })

  it('hitTestReorderTarget reads data-* id and half', () => {
    const host = document.createElement('div')
    host.setAttribute('data-session-id', 'sess_a')
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({ top: 100, height: 40, left: 0, width: 100, bottom: 140, right: 100 }),
    })
    document.body.appendChild(host)
    // jsdom has no elementFromPoint — stub the method itself.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      writable: true,
      value: () => host,
    })
    expect(hitTestReorderTarget(10, 110, 'session-id')).toEqual({ id: 'sess_a', half: 'before' })
    expect(hitTestReorderTarget(10, 130, 'session-id')).toEqual({ id: 'sess_a', half: 'after' })
    host.remove()
  })

  it('disabled rows never arm', () => {
    stubPointer('coarse')
    const onStart = vi.fn()
    render(
      <Harness enabled={false} onStart={onStart} onMove={vi.fn()} onEnd={vi.fn()} />,
    )
    const row = screen.getByTestId('row')
    fireEvent.pointerDown(row, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_REORDER_MS + 20) })
    expect(onStart).not.toHaveBeenCalled()
  })
})
