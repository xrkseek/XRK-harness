/**
 * Shared long-press + pointer-capture helpers for list reorder on touch.
 *
 * HTML5 DnD is unreliable in Android WebView / mobile Safari. Rows arm after a
 * short hold, then track the finger with `setPointerCapture` +
 * `elementFromPoint` so hover still updates when the pointer leaves the source
 * row (without capture, `pointermove` never fires on the source again).
 *
 * Fine pointers (desktop mouse) use HTML5 DnD only — arming a parallel
 * long-press path races native drag and leaves reorder stuck mid-gesture.
 *
 * Armed state lives in a **ref** (paint state is separate). Reading React state
 * inside pointer handlers left `onPointerMove` / `onPointerUp` on a stale
 * `armed === false` after the hold timer, so drops never committed on phone.
 *
 * Scroll vs reorder (coarse):
 * - Default `touch-action: pan-y` so the list still scrolls from a row.
 * - A pending hold cancels on finger travel **or** scroll-parent scroll (native
 *   pan may stop delivering move events to the row).
 * - Only after the hold arms do we claim the finger (`touch-action: none` +
 *   non-passive `touchmove` `preventDefault` + pointer capture). Claiming
 *   `none` from pointerdown permanently forbids scrolling.
 */

import {
  useCallback, useRef, useState, type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

/** Hold before a pointer gesture starts reorder (ms). */
export const LONG_PRESS_REORDER_MS = 420

/** Coarse-pointer cancel radius while the hold timer is pending (px). */
export const LONG_PRESS_CANCEL_MOVE_COARSE_PX = 24

/** Fine-pointer cancel radius (px); fine path rarely uses the timer. */
export const LONG_PRESS_CANCEL_MOVE_FINE_PX = 10

/**
 * Pointer travel that cancels a pending long-press (px). Coarse pointers
 * (phones) need a looser budget — scroll jitter otherwise aborts every hold.
 */
export function longPressCancelMovePx(): number {
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
    return LONG_PRESS_CANCEL_MOVE_COARSE_PX
  }
  return LONG_PRESS_CANCEL_MOVE_FINE_PX
}

/**
 * Whether HTML5 DnD should be enabled for reorder rows.
 * Coarse pointers (phones / Android WebView / hybrid finger use) get
 * long-press + pointer-capture only — leaving `draggable` on steals the hold
 * into a native drag that never delivers dragover/drop to our handlers.
 *
 * Coarse wins over fine: a laptop with a touchscreen still reports
 * `(pointer: fine)`, but the finger path must not take HTML5.
 */
export function prefersHtml5Reorder(): boolean {
  if (typeof matchMedia !== 'function') return true
  if (matchMedia('(pointer: coarse)').matches) return false
  return matchMedia('(pointer: fine)').matches
}

/** Capture the pointer so move/up keep targeting the source row. */
export function capturePointer(el: Element, pointerId: number): void {
  if (!('setPointerCapture' in el)) return
  try {
    ;(el as HTMLElement).setPointerCapture(pointerId)
  } catch {
    // Already released / unsupported — pointer path may still work on desktop.
  }
}

/** Release capture when the gesture ends (ignore if already gone). */
export function releasePointer(el: Element, pointerId: number): void {
  if (!('releasePointerCapture' in el)) return
  try {
    if ((el as HTMLElement).hasPointerCapture?.(pointerId) === true) {
      ;(el as HTMLElement).releasePointerCapture(pointerId)
    }
  } catch {
    // ignore
  }
}

/** Drop half from a pointer/drag Y against a row rect. */
export function dropHalfFromClientY(
  clientY: number,
  rect: { readonly top: number; readonly height: number },
): 'before' | 'after' {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Hit-test the reorder target under a finger / cursor.
 * @param attr - data attribute name without `data-` prefix (e.g. `session-id`).
 */
export function hitTestReorderTarget(
  clientX: number,
  clientY: number,
  attr: 'session-id' | 'workspace-id' | 'provider-id',
): { readonly id: string; readonly half: 'before' | 'after' } | null {
  if (typeof document === 'undefined') return null
  const el = document.elementFromPoint(clientX, clientY)
  if (el === null) return null
  const section = el.closest(`[data-${attr}]`) as HTMLElement | null
  if (section === null) return null
  const id = section.getAttribute(`data-${attr}`)
  if (id === null || id.length === 0) return null
  return { id, half: dropHalfFromClientY(clientY, section.getBoundingClientRect()) }
}

/** Nearest ancestor that can scroll vertically (including the viewport scroller). */
export function nearestVerticalScrollParent(el: Element | null): Element | null {
  if (el === null || typeof window === 'undefined') return null
  let node: Element | null = el.parentElement
  while (node !== null) {
    const style = window.getComputedStyle(node)
    const overflowY = style.overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
      && node.scrollHeight > node.clientHeight + 1
    ) {
      return node
    }
    node = node.parentElement
  }
  return document.scrollingElement ?? document.documentElement
}

export interface LongPressReorderCallbacks {
  /** Gesture armed (long-press fired or HTML5 dragstart). */
  readonly onStart: () => void
  /**
   * Finger moved while armed. Caller hit-tests (`elementFromPoint`) and updates
   * the insert marker — keep this free of React state reads for `armed`.
   */
  readonly onMove: (clientX: number, clientY: number) => void
  /** Pointer up / cancel / HTML5 dragend — commit or clear. */
  readonly onEnd: () => void
}

export interface LongPressReorderBind {
  /** Fine pointer → HTML5; coarse → long-press only. */
  readonly useHtml5: boolean
  /** Visual “holding / dragging” chrome. */
  readonly armed: boolean
  /** Attach to the row root. */
  readonly rowRef: RefObject<HTMLElement | null>
  readonly draggable: boolean
  /**
   * Put on the row root as `style={{ touchAction }}`.
   * - Coarse idle / pending hold: `pan-y` (list must still scroll).
   * - Coarse armed: `none` (plus a non-passive touchmove block).
   * - Fine / HTML5 / disabled: leave unset.
   */
  readonly touchAction: 'none' | 'pan-y' | undefined
  readonly onPointerDown: ((e: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onPointerMove: ((e: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onPointerUp: ((e: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onPointerCancel: ((e: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onLostPointerCapture: ((e: ReactPointerEvent<HTMLElement>) => void) | undefined
  readonly onContextMenu: ((e: { preventDefault(): void }) => void) | undefined
  /** Wire HTML5 `onDragStart` when `useHtml5`. */
  readonly onHtml5DragStart: (() => void) | undefined
  /** Wire HTML5 `onDragEnd` when `useHtml5`. */
  readonly onHtml5DragEnd: (() => void) | undefined
  /**
   * Suppress the click that follows a completed long-press / drag.
   * Call from `onClick` / `onClickCapture` before navigation.
   */
  readonly consumeClickSuppression: () => boolean
}

/**
 * One reorder gesture controller for a list row.
 * @param enabled - false when the row cannot reorder (editor open / read-only).
 * @param callbacks - start / move / end; identities may change every render.
 */
export function useLongPressReorder(
  enabled: boolean,
  callbacks: LongPressReorderCallbacks,
): LongPressReorderBind {
  const useHtml5 = prefersHtml5Reorder()
  const rowRef = useRef<HTMLElement | null>(null)
  const armedRef = useRef(false)
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  /** Snapshot cancel radius for this gesture (avoid matchMedia on every move). */
  const cancelMovePxRef = useRef(LONG_PRESS_CANCEL_MOVE_FINE_PX)
  const suppressClickRef = useRef(false)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  /** Non-passive touchmove blocker installed only while armed. */
  const touchBlockRef = useRef<((e: TouchEvent) => void) | null>(null)
  /** Pending-hold watchers: window touchmove + scroll parent. */
  const pendingWatchRef = useRef<{
    onTouchMove: (e: TouchEvent) => void
    onScroll: () => void
    scrollParent: Element | null
  } | null>(null)

  const removeTouchBlock = useCallback((): void => {
    const el = rowRef.current
    const block = touchBlockRef.current
    if (el !== null && block !== null) {
      el.removeEventListener('touchmove', block)
    }
    touchBlockRef.current = null
  }, [])

  const installTouchBlock = useCallback((): void => {
    const el = rowRef.current
    if (el === null || touchBlockRef.current !== null) return
    const block = (e: TouchEvent): void => {
      e.preventDefault()
    }
    touchBlockRef.current = block
    el.addEventListener('touchmove', block, { passive: false })
  }, [])

  const clearPendingWatch = useCallback((): void => {
    const watch = pendingWatchRef.current
    if (watch === null) return
    if (typeof window !== 'undefined') {
      window.removeEventListener('touchmove', watch.onTouchMove)
    }
    watch.scrollParent?.removeEventListener('scroll', watch.onScroll)
    pendingWatchRef.current = null
  }, [])

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    originRef.current = null
    clearPendingWatch()
  }, [clearPendingWatch])

  const finishCapture = useCallback((): void => {
    const el = rowRef.current
    const id = pointerIdRef.current
    if (el !== null && id !== null) releasePointer(el, id)
    pointerIdRef.current = null
  }, [])

  const abortPending = useCallback((): void => {
    clearTimer()
    pointerIdRef.current = null
  }, [clearTimer])

  const arm = useCallback((): void => {
    if (armedRef.current) return
    armedRef.current = true
    setArmed(true)
    suppressClickRef.current = true
    originRef.current = null
    clearPendingWatch()
    const el = rowRef.current
    const id = pointerIdRef.current
    if (el !== null && id !== null) capturePointer(el, id)
    installTouchBlock()
    callbacksRef.current.onStart()
  }, [clearPendingWatch, installTouchBlock])

  const endGesture = useCallback((): void => {
    const wasArmed = armedRef.current
    clearTimer()
    removeTouchBlock()
    finishCapture()
    if (!wasArmed) return
    armedRef.current = false
    setArmed(false)
    callbacksRef.current.onEnd()
  }, [clearTimer, finishCapture, removeTouchBlock])

  const isActivePointer = (pointerId: number): boolean =>
    pointerIdRef.current !== null && pointerIdRef.current === pointerId

  const installPendingWatch = useCallback((): void => {
    if (typeof window === 'undefined') return
    clearPendingWatch()
    const onTouchMove = (e: TouchEvent): void => {
      const origin = originRef.current
      if (origin === null || timerRef.current === null) return
      const t = e.touches.item(0)
      if (t === null) return
      if (Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > cancelMovePxRef.current) {
        abortPending()
      }
    }
    const onScroll = (): void => {
      if (timerRef.current !== null) abortPending()
    }
    const scrollParent = nearestVerticalScrollParent(rowRef.current)
    pendingWatchRef.current = { onTouchMove, onScroll, scrollParent }
    // Passive: never block scroll; only cancel the pending hold.
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    scrollParent?.addEventListener('scroll', onScroll, { passive: true })
  }, [abortPending, clearPendingWatch])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || useHtml5) return
    if (e.button !== 0) return
    // Ignore extra fingers while a hold/drag is in progress.
    if (pointerIdRef.current !== null) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    clearTimer()
    pointerIdRef.current = e.pointerId
    cancelMovePxRef.current = longPressCancelMovePx()
    originRef.current = { x: e.clientX, y: e.clientY }
    installPendingWatch()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      arm()
    }, LONG_PRESS_REORDER_MS)
  }, [arm, clearTimer, enabled, installPendingWatch, useHtml5])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || useHtml5) return
    if (!isActivePointer(e.pointerId)) return
    const origin = originRef.current
    if (origin !== null && timerRef.current !== null) {
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > cancelMovePxRef.current) {
        abortPending()
      }
      return
    }
    if (!armedRef.current) return
    // Stop the scrollport from eating the finger after the hold arms.
    e.preventDefault()
    callbacksRef.current.onMove(e.clientX, e.clientY)
  }, [abortPending, enabled, useHtml5])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || useHtml5) return
    if (!isActivePointer(e.pointerId)) return
    endGesture()
  }, [enabled, endGesture, useHtml5])

  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || useHtml5) return
    if (!isActivePointer(e.pointerId)) return
    endGesture()
  }, [enabled, endGesture, useHtml5])

  const onLostPointerCapture = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || useHtml5) return
    if (!isActivePointer(e.pointerId)) return
    // Browser took the capture (scroll / system gesture) — commit or clear.
    endGesture()
  }, [enabled, endGesture, useHtml5])

  const onContextMenu = useCallback((e: { preventDefault(): void }): void => {
    if (!enabled || useHtml5) return
    if (armedRef.current || timerRef.current !== null) e.preventDefault()
  }, [enabled, useHtml5])

  const onHtml5DragStart = useCallback((): void => {
    if (!enabled || !useHtml5) return
    clearTimer()
    suppressClickRef.current = true
    armedRef.current = true
    setArmed(true)
    callbacksRef.current.onStart()
  }, [clearTimer, enabled, useHtml5])

  const onHtml5DragEnd = useCallback((): void => {
    if (!enabled || !useHtml5) return
    endGesture()
  }, [enabled, endGesture, useHtml5])

  const consumeClickSuppression = useCallback((): boolean => {
    if (suppressClickRef.current || armedRef.current) {
      suppressClickRef.current = false
      return true
    }
    return false
  }, [])

  return {
    useHtml5,
    armed,
    rowRef,
    draggable: enabled && useHtml5,
    // Idle: pan-y so lists scroll. Armed: none (gesture already claimed via
    // capture + non-passive touchmove). Never leave none on forever.
    touchAction: enabled && !useHtml5 ? (armed ? 'none' : 'pan-y') : undefined,
    onPointerDown: enabled && !useHtml5 ? onPointerDown : undefined,
    onPointerMove: enabled && !useHtml5 ? onPointerMove : undefined,
    onPointerUp: enabled && !useHtml5 ? onPointerUp : undefined,
    onPointerCancel: enabled && !useHtml5 ? onPointerCancel : undefined,
    onLostPointerCapture: enabled && !useHtml5 ? onLostPointerCapture : undefined,
    onContextMenu: enabled && !useHtml5 ? onContextMenu : undefined,
    onHtml5DragStart: enabled && useHtml5 ? onHtml5DragStart : undefined,
    onHtml5DragEnd: enabled && useHtml5 ? onHtml5DragEnd : undefined,
    consumeClickSuppression,
  }
}
