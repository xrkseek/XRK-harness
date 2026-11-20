/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  beginExpandPreserve,
  cancelExpandPreserve,
  isExpandFollowSuppressed,
  registerExpandScrollWriter,
  settleExpandPreserve,
  useExpandScrollPreserve,
} from '../src/expand-scroll-preserve.ts'

function mountScrollScene(options: {
  readonly anchorTop: number
  readonly anchorHeight: number
  readonly visibleBottom: number
  readonly scrollTop?: number
  readonly scrollHeight?: number
  readonly clientHeight?: number
}): {
  readonly scrollport: HTMLElement
  readonly anchor: HTMLElement
  readonly setAnchorTop: (top: number) => void
} {
  const scrollport = document.createElement('div')
  scrollport.setAttribute('data-conversation-scroll', '')
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-seat', '')
  const anchor = document.createElement('div')
  scrollport.append(anchor, composer)
  document.body.append(scrollport)

  let scrollTop = options.scrollTop ?? 0
  const scrollHeight = options.scrollHeight ?? 2000
  const clientHeight = options.clientHeight ?? 700
  Object.defineProperty(scrollport, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = value },
  })
  Object.defineProperty(scrollport, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  Object.defineProperty(scrollport, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })

  let anchorTop = options.anchorTop
  const anchorHeight = options.anchorHeight
  vi.spyOn(scrollport, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: options.visibleBottom,
    left: 0,
    right: 320,
    width: 320,
    height: options.visibleBottom,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({
    top: options.visibleBottom,
    bottom: options.visibleBottom + 120,
    left: 0,
    right: 320,
    width: 320,
    height: 120,
    x: 0,
    y: options.visibleBottom,
    toJSON: () => ({}),
  })
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
    top: anchorTop,
    bottom: anchorTop + anchorHeight,
    left: 16,
    right: 304,
    width: 288,
    height: anchorHeight,
    x: 16,
    y: anchorTop,
    toJSON: () => ({}),
  }))

  return {
    scrollport,
    anchor,
    setAnchorTop: (top: number) => { anchorTop = top },
  }
}

afterEach(() => {
  cancelExpandPreserve()
  registerExpandScrollWriter(null)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('expand-scroll-preserve', () => {
  it('suppresses follow and restores mid-column anchor Y after expand', () => {
    const writes: number[] = []
    registerExpandScrollWriter((_scrollport, top) => { writes.push(top) })
    const scene = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })

    const id = beginExpandPreserve(scene.anchor)
    expect(id).not.toBeNull()
    expect(isExpandFollowSuppressed()).toBe(true)

    // Floor re-pin lifts the header (top 80→20) by raising scrollTop 400→460.
    // Restore: scrollTop + (after − before) = 460 + (20 − 80) = 400.
    scene.setAnchorTop(20)
    scene.scrollport.scrollTop = 460
    settleExpandPreserve(id)

    expect(writes).toEqual([400])
    expect(isExpandFollowSuppressed()).toBe(true)
  })

  it('always syncs the writer even when Y did not move', () => {
    const writes: number[] = []
    registerExpandScrollWriter((_scrollport, top) => { writes.push(top) })
    const scene = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })

    const id = beginExpandPreserve(scene.anchor)
    settleExpandPreserve(id)
    // Same scrollTop — ChatView still needs the write to clear atBottom.
    expect(writes).toEqual([400])
  })

  it('skips tip-of-floor expands without clearing an in-flight mid-column pending', () => {
    const mid = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })
    const midId = beginExpandPreserve(mid.anchor)
    expect(midId).not.toBeNull()

    const tip = mountScrollScene({
      anchorTop: 540,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 1300,
    })
    expect(beginExpandPreserve(tip.anchor)).toBeNull()
    expect(isExpandFollowSuppressed()).toBe(true)

    const writes: number[] = []
    registerExpandScrollWriter((_scrollport, top) => { writes.push(top) })
    mid.setAnchorTop(40)
    mid.scrollport.scrollTop = 440
    settleExpandPreserve(midId)
    expect(writes).toEqual([400])
  })

  it('ignores a stale settle token after a newer begin', () => {
    const writes: number[] = []
    registerExpandScrollWriter((_scrollport, top) => { writes.push(top) })
    const first = mountScrollScene({
      anchorTop: 100,
      anchorHeight: 40,
      visibleBottom: 600,
      scrollTop: 200,
    })
    const stale = beginExpandPreserve(first.anchor)
    first.anchor.remove()

    const second = mountScrollScene({
      anchorTop: 120,
      anchorHeight: 40,
      visibleBottom: 600,
      scrollTop: 220,
    })
    const fresh = beginExpandPreserve(second.anchor)
    second.setAnchorTop(60)
    second.scrollport.scrollTop = 280

    settleExpandPreserve(stale)
    expect(writes).toEqual([])

    settleExpandPreserve(fresh)
    expect(writes).toEqual([220])
  })

  it('cancel drops pending and the begin suppress window', () => {
    const scene = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })
    const id = beginExpandPreserve(scene.anchor)
    expect(id).not.toBeNull()
    expect(isExpandFollowSuppressed()).toBe(true)

    cancelExpandPreserve(id)
    expect(isExpandFollowSuppressed()).toBe(false)
  })

  it('cancel with a stale id leaves a newer pending alone', () => {
    const first = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })
    const stale = beginExpandPreserve(first.anchor)
    const second = mountScrollScene({
      anchorTop: 100,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 420,
    })
    const fresh = beginExpandPreserve(second.anchor)
    expect(fresh).not.toBeNull()

    cancelExpandPreserve(stale)
    expect(isExpandFollowSuppressed()).toBe(true)

    cancelExpandPreserve(fresh)
    expect(isExpandFollowSuppressed()).toBe(false)
  })

  it('hook settles on open and cancels a noteExpand that never opens', () => {
    const writes: number[] = []
    registerExpandScrollWriter((_scrollport, top) => { writes.push(top) })
    const scene = mountScrollScene({
      anchorTop: 80,
      anchorHeight: 36,
      visibleBottom: 600,
      scrollTop: 400,
    })

    const { result, rerender, unmount } = renderHook(
      ({ open }) => useExpandScrollPreserve(open),
      { initialProps: { open: false } },
    )
    // Bind the measured root to the scroll scene anchor.
    Object.defineProperty(result.current.rootRef, 'current', {
      configurable: true,
      get: () => scene.anchor,
      set: () => {},
    })

    act(() => { result.current.noteExpand() })
    expect(isExpandFollowSuppressed()).toBe(true)

    act(() => { rerender({ open: true }) })
    expect(writes).toEqual([400])
    // Drop the short post-settle suppress so the next assertion is about pending.
    vi.spyOn(performance, 'now').mockReturnValue(10_000)
    expect(isExpandFollowSuppressed()).toBe(false)
    vi.mocked(performance.now).mockRestore()

    act(() => { result.current.noteExpand() })
    expect(isExpandFollowSuppressed()).toBe(true)
    // Unmount mid-gesture (noteExpand without open=true) must clear module pending.
    unmount()
    expect(isExpandFollowSuppressed()).toBe(false)
  })
})
