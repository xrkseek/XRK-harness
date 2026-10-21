/**
 * Notifier: microtask/frame batching, rebuild-before-notify ordering,
 * no-listener laziness, synchronous notifyNow, and unsubscribe.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/client/sessions/notifier.ts'

const microtask = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Notifier', () => {
  it('collapses N markDirty calls into one flush, rebuilding before notifying', async () => {
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.markDirty()
    notifier.markDirty()
    notifier.markDirty()
    expect(order).toEqual([]) // nothing until the microtask boundary
    await microtask()
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('skips rebuild with zero listeners and ensureFresh rebuilds lazily exactly once', async () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.markDirty()
    await microtask()
    expect(rebuilds).toBe(0) // lazy: kept dirty
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1) // clean: no second rebuild
  })

  it('notifyNow runs listeners synchronously (controlled-input contract)', () => {
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.notifyNow()
    expect(order).toEqual(['rebuild', 'notify']) // before returning, no microtask needed
  })

  it('notifyNow with zero listeners stays lazy like markDirty', () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.notifyNow()
    expect(rebuilds).toBe(0)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
  })

  it('a scheduled flush after notifyNow already flushed is a no-op', async () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.subscribe(() => undefined)
    notifier.markDirty() // schedules the microtask flush
    notifier.notifyNow() // flushes synchronously, clears dirty
    await microtask() // the scheduled flush finds dirty=false
    expect(rebuilds).toBe(1)
  })

  it('collapses frame-dirty changes into one cumulative frame publication', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    notifier.markFrameDirty()

    expect(order).toEqual([])
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('defers the next stream paint when the previous frame flush was recent', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(notifications).toBe(1)

    notifier.markFrameDirty()
    expect(frames).toHaveLength(0) // budget: not armed yet
    vi.advanceTimersByTime(48)
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(notifications).toBe(2)
    vi.useRealTimers()
  })

  it('widens the stream budget after a slow frame flush', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const now = vi.spyOn(Date, 'now')
    let clock = 1_000
    now.mockImplementation(() => clock)
    const notifier = new Notifier(() => {
      clock += 80 // simulate heavy Markdown / tool paint inside flush
    })
    notifier.subscribe(() => undefined)

    notifier.markFrameDirty()
    frames.shift()!(0)
    expect(clock).toBe(1_080)

    notifier.markFrameDirty()
    expect(frames).toHaveLength(0)
    clock += 48
    vi.advanceTimersByTime(48)
    expect(frames).toHaveLength(0) // still inside the widened budget
    clock += 112
    vi.advanceTimersByTime(112)
    expect(frames).toHaveLength(1)
    now.mockRestore()
    vi.useRealTimers()
  })

  it('yields one stream paint when the browser reports pending input', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('navigator', {
      scheduling: { isInputPending: () => true },
    })
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    expect(frames).toHaveLength(0)
    vi.advanceTimersByTime(0)
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(notifications).toBe(1)
    vi.useRealTimers()
  })

  it('prefers scheduler.postTask(user-visible) for stream paints when available', () => {
    const tasks: Array<() => void> = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('scheduler', {
      postTask: (callback: () => void, options?: { priority?: string }) => {
        expect(options?.priority).toBe('user-visible')
        tasks.push(callback)
      },
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    expect(tasks).toHaveLength(1)
    expect(frames).toHaveLength(0)
    tasks.shift()!()
    expect(notifications).toBe(1)
  })

  it('continueFrameDirty skips the adaptive paint budget', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const now = vi.spyOn(Date, 'now')
    let clock = 1_000
    now.mockImplementation(() => clock)
    const notifier = new Notifier(() => { clock += 80 })
    notifier.subscribe(() => undefined)

    notifier.markFrameDirty()
    frames.shift()!(0) // budget widens after a slow flush
    notifier.continueFrameDirty()
    expect(frames).toHaveLength(1) // no 160ms wait
    frames.shift()!(0)
    now.mockRestore()
    vi.useRealTimers()
  })

  it('eases the stream budget back down after a cheap flush', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const now = vi.spyOn(Date, 'now')
    let clock = 1_000
    now.mockImplementation(() => clock)
    let flushCost = 80
    const notifier = new Notifier(() => { clock += flushCost })
    notifier.subscribe(() => undefined)

    notifier.markFrameDirty()
    frames.shift()!(0) // budget → 160
    flushCost = 1
    notifier.markFrameDirty()
    clock += 160
    vi.advanceTimersByTime(160)
    frames.shift()!(0) // ease toward 48 → ~132
    notifier.markFrameDirty()
    expect(frames).toHaveLength(0)
    clock += 100
    vi.advanceTimersByTime(100)
    expect(frames).toHaveLength(0) // still above the idle 48ms floor
    clock += 40
    vi.advanceTimersByTime(40)
    expect(frames).toHaveLength(1)
    now.mockRestore()
    vi.useRealTimers()
  })

  it('keeps stream paints bounded under a token storm', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let paints = 0
    const notifier = new Notifier(() => { paints += 1 })
    notifier.subscribe(() => undefined)

    const drain = (): void => {
      while (frames.length > 0) frames.shift()!(0)
    }

    // ~200 Hz for 2s. Unbounded rAF would paint ~400 times; the budget is ~20 Hz.
    for (let i = 0; i < 400; i++) {
      notifier.markFrameDirty()
      drain()
      vi.advanceTimersByTime(5)
    }
    drain()
    vi.advanceTimersByTime(48)
    drain()

    expect(paints).toBeGreaterThan(10)
    expect(paints).toBeLessThan(80)
    vi.useRealTimers()
  })

  it('lets a structural microtask publication supersede a pending frame', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markDirty()
    await microtask()
    expect(notifications).toBe(1)

    frames.shift()!(0)
    expect(notifications).toBe(1)
  })

  it('falls back to microtask batching when animation frames are unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    expect(notifications).toBe(0)
    await microtask()
    expect(notifications).toBe(1)
  })

  it('unsubscribed listeners stop receiving notifications', async () => {
    let calls = 0
    const notifier = new Notifier(() => undefined)
    const unsubscribe = notifier.subscribe(() => { calls++ })
    notifier.notifyNow()
    expect(calls).toBe(1)
    unsubscribe()
    notifier.markDirty()
    await microtask()
    notifier.notifyNow()
    expect(calls).toBe(1)
  })

  it('one throwing listener does not rob the rest of the round', () => {
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => { order.push('before'); throw new Error('bad subscriber') })
    notifier.subscribe(() => { order.push('after') })
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args[0])
    })
    notifier.notifyNow()
    expect(order).toEqual(['rebuild', 'before', 'after'])
    expect(errors).toHaveLength(1)
    spy.mockRestore()
  })

  it('re-arms a frame publication the suspended animation clock never delivered', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    expect(frames).toHaveLength(1)
    now.mockReturnValue(1_100)
    notifier.markFrameDirty()
    expect(frames).toHaveLength(1) // inside the frame window: still one batch
    now.mockReturnValue(1_400)
    notifier.markFrameDirty()
    expect(frames).toHaveLength(2) // stalled: re-armed instead of swallowed

    frames[1]!(0)
    expect(notifications).toBe(1)
    frames[0]!(0) // superseded: retired by the generation bump
    expect(notifications).toBe(1)
    now.mockRestore()
  })

  it('drains a publication stranded by a hidden window on the wake edge', async () => {
    // The wake listener binds once per document, so this case needs a fresh
    // module instance — the lane's own jsdom document is already bound by
    // whichever frame case ran first.
    vi.resetModules()
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener) },
    })
    vi.stubGlobal('requestAnimationFrame', () => 1) // armed, never delivered
    const { Notifier: FreshNotifier } = await import('../src/client/sessions/notifier.ts')
    let notifications = 0
    const notifier = new FreshNotifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    expect(notifications).toBe(0)
    listeners.get('visibilitychange')!()
    expect(notifications).toBe(1)
  })
})
