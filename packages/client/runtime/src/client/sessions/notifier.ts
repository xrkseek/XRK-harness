// Notifier: subscription + batched notification primitive shared by Session and
// SessionManager. Semantics: N markDirty calls collapse into one microtask flush, while
// N markFrameDirty calls collapse into one animation-frame flush;
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
    this.schedule('microtask')
  }

  /** Stream-change entry: mark dirty and publish the cumulative state at most once per frame. */
  markFrameDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask') return
    // Never let one lost frame swallow every later stream change: past the stall
    // window the outstanding callback is presumed dead and a fresh one is armed
    // (the generation bump retires the straggler).
    if (this.scheduled === 'frame' && Date.now() - this.frameArmedAt < FRAME_STALL_MS) return
    this.schedule(typeof globalThis.requestAnimationFrame === 'function' ? 'frame' : 'microtask')
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
      this.scheduled = 'none'
      this.flush()
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
      globalThis.requestAnimationFrame(armed)
      return
    }
    queueMicrotask(publish)
  }

  private invalidateSchedule(): void {
    this.scheduleGeneration++
    this.scheduled = 'none'
    if (this.strandedFrame !== null) strandedFramePublications.delete(this.strandedFrame)
    this.strandedFrame = null
  }

  private flush(): void {
    if (!this.notifyPending) return
    if (this.listeners.size === 0) return // lazy: dirty (if still set) rebuilds on next getSnapshot
    this.notifyPending = false
    if (this.dirty) {
      this.dirty = false
      this.rebuild()
    }
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
