// Notifier: subscription + batched notification primitive shared by Session and
// SessionManager. Semantics: N markDirty calls collapse into one microtask flush, while
// N markFrameDirty calls collapse into one animation-frame flush (with a stream paint
// budget so heavy Think/Markdown work cannot stack at display refresh rate);
// the flush rebuilds the snapshot cache BEFORE notifying (useSyncExternalStore requires a stable
// getSnapshot reference). With no listeners the rebuild is skipped and only the dirty bit is set
// (keeps frame storms cheap); the next getSnapshot rebuilds lazily.
//
// Freshness and notification are SEPARATE bits: a pull (ensureFresh) between
// markDirty and the scheduled flush rebuilds the snapshot but must not
// swallow the notification — push subscribers (object-layer watchers) would
// otherwise starve whenever any reader pulls first.
//
// A frame publication must also survive a SUSPENDED animation clock: Chromium
// stops requestAnimationFrame while the window is hidden or occluded (Desktop
// keeps the Electron default backgroundThrottling), and a dropped callback would
// otherwise strand `scheduled = 'frame'` forever — the re-entrancy guard then
// swallows every later markFrameDirty, so a streaming reply stops painting until
// a reload. Recovery is two-sided: a stalled frame is re-armed by the next stream
// change ({@link FRAME_STALL_MS}), and a wake edge drains whatever a suspended
// frame left pending.

/**
 * A frame callback older than this is treated as LOST rather than late (window
 * hidden: rAF is suspended, not merely delayed) and re-armed by the next stream
 * change. A frame is ~16ms; the slack absorbs a slow frame without ever
 * re-scheduling per chunk.
 */
const FRAME_STALL_MS = 250

/**
 * Baseline gap between stream (animation-frame) paints. Token deltas often arrive
 * faster than the main thread can parse Markdown / layout a long transcript; at
 * 60Hz the UI falls behind the durable log ("Think still typing" while Host already
 * spawned subagents). ~20fps is the idle budget; a slow flush widens it so input
 * (Ctrl+Enter echo) can land between paints. Structural markDirty / notifyNow
 * still flush immediately.
 */
const STREAM_PAINT_MIN_MS = 48

/** Cap when the previous stream flush was expensive (Markdown / tool DOM). */
const STREAM_PAINT_MAX_MS = 160

/** Flush wall time that widens the next stream budget. */
const STREAM_FLUSH_SLOW_MS = 40

/** Frame publications whose rAF callback has not landed yet (wake-edge recovery targets). */
const strandedFramePublications = new Set<() => void>()
let frameWakeBound = false

/** Structural host surface for the wake edge (browser build has a DOM; node tests do not). */
interface FrameWakeHost {
  readonly document?: {
    readonly visibilityState?: string
    addEventListener?(type: 'visibilitychange', listener: () => void): void
  }
  addEventListener?(type: 'pageshow', listener: () => void): void
  readonly navigator?: {
    readonly scheduling?: {
      isInputPending?(options?: { includeContinuous?: boolean }): boolean
    }
  }
  readonly scheduler?: {
    postTask?(
      callback: () => void,
      options?: { priority?: 'user-blocking' | 'user-visible' | 'background' },
    ): unknown
  }
}

/**
 * Schedule a stream paint cooperatively when the browser exposes Scheduler API.
 * Priority is `user-visible` (not `background`): streaming Think/text is on-screen
 * work that must still yield to `user-blocking` input (Ctrl+Enter), but must not
 * sit behind analytics-class tasks or the transcript looks frozen. rAF is the
 * portable fallback (tests / older Chromium).
 */
function scheduleStreamCallback(armed: () => void): void {
  const postTask = (globalThis as unknown as FrameWakeHost).scheduler?.postTask
  if (typeof postTask === 'function') {
    try {
      postTask.call((globalThis as unknown as FrameWakeHost).scheduler, armed, {
        priority: 'user-visible',
      })
      return
    } catch {
      // Fall through to rAF when postTask rejects the priority or is stubbed.
    }
  }
  globalThis.requestAnimationFrame(armed)
}

/**
 * True when the browser reports a pending discrete input event. Used to defer
 * a stream paint so Ctrl+Enter / typing is not stranded behind Markdown work.
 */
function isInputPending(): boolean {
  try {
    return (globalThis as unknown as FrameWakeHost).navigator?.scheduling?.isInputPending?.() === true
  } catch {
    return false
  }
}

/**
 * Bind the one wake listener per document that drains publications stranded by a
 * suspended frame clock. Idempotent; a no-op outside the browser.
 */
function bindFrameWake(): void {
  if (frameWakeBound) return
  const host = globalThis as unknown as FrameWakeHost
  const doc = host.document
  if (doc === undefined || doc.addEventListener === undefined) return
  frameWakeBound = true
  const wake = (): void => {
    if (doc.visibilityState === 'hidden') return
    // Copy: every straggler removes itself from the set as it fires.
    for (const publish of [...strandedFramePublications]) publish()
  }
  doc.addEventListener('visibilitychange', wake)
  host.addEventListener?.('pageshow', wake)
}

/** Subscription + batched notification primitive (shared by Session and SessionManager). */
export class Notifier {
  private listeners = new Set<() => void>()
  private dirty = false
  private notifyPending = false
  private scheduled: 'none' | 'microtask' | 'frame' = 'none'
  private scheduleGeneration = 0
  /** Outstanding frame publication while its rAF callback has not landed (wake-edge handle). */
  private strandedFrame: (() => void) | null = null
  /** When the outstanding frame publication was armed (stall detection). */
  private frameArmedAt = 0
  /** Last completed frame flush (stream paint budget). */
  private lastFrameFlushAt = 0
  /** Adaptive gap before the next stream paint (widens after a slow flush). */
  private streamPaintBudgetMs = STREAM_PAINT_MIN_MS
  /** Deferred arm when a frame flush happened too recently or input is pending. */
  private delayedFrameTimer: ReturnType<typeof setTimeout> | null = null

  /** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
  constructor(private readonly rebuild: () => void) {}

  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** State-change entry: mark dirty and schedule the batched flush. */
  markDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask') return
    this.clearDelayedFrame()
    this.schedule('microtask')
  }

  /**
   * Stream-change entry: mark dirty and publish the cumulative state at most
   * once per paint budget (~20fps idle, slower after a heavy flush). Coalesces
   * token storms so the renderer can catch the durable log instead of painting
   * every delta behind. Yields once when the browser reports pending input.
   */
  markFrameDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask') return
    // Never let one lost frame swallow every later stream change: past the stall
    // window the outstanding callback is presumed dead and a fresh one is armed
    // (the generation bump retires the straggler).
    if (this.scheduled === 'frame' && Date.now() - this.frameArmedAt < FRAME_STALL_MS) return
    if (this.delayedFrameTimer !== null) return

    const useFrame = typeof globalThis.requestAnimationFrame === 'function'
    if (!useFrame) {
      this.schedule('microtask')
      return
    }

    // Stalled clock: re-arm immediately. Budget / input yield only apply when no
    // frame is outstanding — otherwise armStreamFrame would no-op on scheduled=frame.
    if (this.scheduled === 'frame') {
      this.schedule('frame')
      return
    }
    this.armStreamFrame()
  }

  /**
   * Continue a time-sliced stream drain without re-applying the adaptive paint
   * gap. The previous slice already yielded; waiting another 48–160ms here left
   * the assembler lagging the durable log after a multi-run merge.
   */
  continueFrameDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask' || this.scheduled === 'frame') return
    if (this.delayedFrameTimer !== null) return
    const useFrame = typeof globalThis.requestAnimationFrame === 'function'
    if (!useFrame) {
      this.schedule('microtask')
      return
    }
    this.schedule('frame')
  }

  /**
   * Synchronous flush: controlled-input writes must notify in the same tick as
   * onChange, or React rolls the DOM back to the stale value and the caret jumps to the end.
   */
  notifyNow(): void {
    this.dirty = true
    this.notifyPending = true
    this.invalidateSchedule()
    this.flush()
  }

  /**
   * Pre-getSnapshot check: rebuild synchronously when dirty (read path
   * before first subscribe / while unobserved). Notification stays pending.
   */
  ensureFresh(): void {
    if (!this.dirty) return
    this.dirty = false
    this.rebuild()
  }

  private clearDelayedFrame(): void {
    if (this.delayedFrameTimer === null) return
    clearTimeout(this.delayedFrameTimer)
    this.delayedFrameTimer = null
  }

  /**
   * Arm a stream frame after the adaptive budget, yielding once when input is
   * pending so Ctrl+Enter / typing can run before the next Markdown paint.
   */
  private armStreamFrame(): void {
    if (this.delayedFrameTimer !== null) return
    if (this.scheduled === 'microtask') return

    if (isInputPending()) {
      this.delayedFrameTimer = setTimeout(() => {
        this.delayedFrameTimer = null
        if (!this.notifyPending) return
        if (this.scheduled === 'microtask' || this.scheduled === 'frame') return
        // One yield is enough — do not spin on a sticky isInputPending.
        this.armStreamFrameAfterBudget()
      }, 0)
      return
    }
    this.armStreamFrameAfterBudget()
  }

  private armStreamFrameAfterBudget(): void {
    if (this.delayedFrameTimer !== null) return
    if (this.scheduled === 'microtask' || this.scheduled === 'frame') return

    const wait = this.streamPaintBudgetMs - (Date.now() - this.lastFrameFlushAt)
    if (wait > 0) {
      this.delayedFrameTimer = setTimeout(() => {
        this.delayedFrameTimer = null
        if (!this.notifyPending) return
        if (this.scheduled === 'microtask' || this.scheduled === 'frame') return
        this.schedule('frame')
      }, wait)
      return
    }
    this.schedule('frame')
  }

  private adaptStreamBudget(flushDurationMs: number): void {
    const target = flushDurationMs >= STREAM_FLUSH_SLOW_MS
      ? Math.min(STREAM_PAINT_MAX_MS, Math.max(STREAM_PAINT_MIN_MS, flushDurationMs * 2))
      : STREAM_PAINT_MIN_MS
    // Ramp up immediately under load; ease back down so a single cheap frame
    // does not snap to 20fps while the transcript is still heavy.
    if (target >= this.streamPaintBudgetMs) {
      this.streamPaintBudgetMs = target
      return
    }
    this.streamPaintBudgetMs = Math.max(
      STREAM_PAINT_MIN_MS,
      Math.round(this.streamPaintBudgetMs * 0.75 + target * 0.25),
    )
  }

  private schedule(kind: 'microtask' | 'frame'): void {
    const generation = ++this.scheduleGeneration
    this.scheduled = kind
    // A re-arm supersedes the previous publication: retire its wake-edge seat,
    // or a stalled clock would accumulate one handle per retry.
    if (this.strandedFrame !== null) {
      strandedFramePublications.delete(this.strandedFrame)
      this.strandedFrame = null
    }
    const publish = () => {
      if (generation !== this.scheduleGeneration) return
      const wasFrame = this.scheduled === 'frame'
      this.scheduled = 'none'
      const started = Date.now()
      this.flush()
      if (wasFrame) {
        const duration = Date.now() - started
        this.lastFrameFlushAt = Date.now()
        this.adaptStreamBudget(duration)
      }
    }
    if (kind === 'frame') {
      bindFrameWake()
      this.frameArmedAt = Date.now()
      let fired = false
      const armed = (): void => {
        if (fired) return
        fired = true
        strandedFramePublications.delete(armed)
        if (this.strandedFrame === armed) this.strandedFrame = null
        publish()
      }
      this.strandedFrame = armed
      strandedFramePublications.add(armed)
      // user-visible postTask yields to input; rAF is the portable fallback.
      scheduleStreamCallback(armed)
      return
    }
    queueMicrotask(publish)
  }

  private invalidateSchedule(): void {
    this.scheduleGeneration++
    this.scheduled = 'none'
    this.clearDelayedFrame()
    if (this.strandedFrame !== null) strandedFramePublications.delete(this.strandedFrame)
    this.strandedFrame = null
  }

  private flush(): void {
    if (!this.notifyPending) return
    if (this.listeners.size === 0) return // lazy: dirty (if still set) rebuilds on next getSnapshot
    this.notifyPending = false
    // Always rebuild when notifying. ensureFresh may clear `dirty` while leaving
    // notifyPending for a coalesced stream frame (soft submission echo); a
    // dirty-gated rebuild would then notify-only and never drain deferred chunks.
    this.dirty = false
    this.rebuild()
    // Listener isolation: a subscriber throwing must not rob the rest of the
    // round. Unisolated, one bad listener truncated the iteration and left
    // every later view stale for that flush — which the next markDirty would
    // have "fixed" by redelivering, except the thrower was already gone by then
    // and the ring looked identical to the suspended-frame symptom.
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[client-runtime] session snapshot listener threw:', error)
      }
    }
  }
}
