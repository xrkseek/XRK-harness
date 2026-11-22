/**
 * Keep a mid-column disclosure from looking like it "expands upward".
 *
 * Root cause: ChatView's ResizeObserver floor-follow re-pins `scrollTop` on
 * any growth while `atBottom`. On a short mobile viewport that lifts the
 * header the reader just opened off-screen.
 *
 * One module-level pending is enough: a single conversation scrollport owns
 * follow, and a tap cannot open two disclosures in the same frame.
 *
 * Tip-of-floor expands are left alone so streaming growth near the composer
 * still follows.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Scrollport attribute ChatView stamps on the transcript host. */
const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'

type WriteScroll = (scrollport: HTMLElement, top: number) => void

interface PendingPreserve {
  readonly el: HTMLElement
  readonly top: number
  readonly scrollport: HTMLElement
  readonly id: number
}

/** Tip band: expansions already on the floor keep bottom-follow. */
const TIP_SLACK_PX = 48

let pending: PendingPreserve | null = null
let suppressUntil = 0
let writeScrollHook: WriteScroll | null = null
let nextId = 1

/** Resolve the conversation scrollport that owns an in-flow element. */
export function expandScrollerOf(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>(SCROLLPORT_SELECTOR)
}

/**
 * ChatView registers its observed-top / atBottom writer so a restore does not
 * look like reader input, and so a no-op Y restore still clears the floor latch.
 */
export function registerExpandScrollWriter(write: WriteScroll | null): void {
  writeScrollHook = write
}

/**
 * Programmatic scroll through ChatView's ledger when registered; otherwise a
 * raw `scrollTop` write. Selection edge-scroll / focus re-pins must use this
 * so onScroll does not treat the motion as a reader flick (or snap toBottom).
 */
export function writeConversationScroll(scrollport: HTMLElement, top: number): void {
  if (writeScrollHook !== null) writeScrollHook(scrollport, top)
  else scrollport.scrollTop = top
}

/** Whether ChatView should skip a floor re-pin for the current growth. */
export function isExpandFollowSuppressed(): boolean {
  return pending !== null || performance.now() < suppressUntil
}

/**
 * Record the anchor before the body mounts. Tip-of-floor expands return null
 * without touching an in-flight pending from another row.
 * @returns a token for {@link settleExpandPreserve}, or null when skipped.
 */
export function beginExpandPreserve(anchor: HTMLElement): number | null {
  const scrollport = expandScrollerOf(anchor)
  if (scrollport === null) return null
  const port = scrollport.getBoundingClientRect()
  const rect = anchor.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? port.bottom
  if (rect.bottom >= visibleBottom - TIP_SLACK_PX) return null
  const id = nextId++
  suppressUntil = performance.now() + 300
  pending = { el: anchor, top: rect.top, scrollport, id }
  return id
}

/**
 * After the open body has laid out, put the anchor back at its pre-expand Y
 * (no-op when nothing moved) and always sync the ChatView ledger so `atBottom`
 * drops when the floor grew away under a suppressed pin.
 */
export function settleExpandPreserve(id?: number | null): void {
  const held = pending
  if (held === null) return
  if (id != null && held.id !== id) return
  pending = null
  // Cover a ResizeObserver that lands after this restore.
  suppressUntil = Math.max(suppressUntil, performance.now() + 80)
  if (!held.el.isConnected) return
  const after = held.el.getBoundingClientRect().top
  const delta = after - held.top
  let top = held.scrollport.scrollTop
  if (Math.abs(delta) >= 0.5) {
    const floorMax = Math.max(0, held.scrollport.scrollHeight - held.scrollport.clientHeight)
    top = Math.min(Math.max(0, held.scrollport.scrollTop + delta), floorMax)
  }
  // Always write: even a 0-delta restore must refresh atBottom / observedTop.
  if (writeScrollHook !== null) writeScrollHook(held.scrollport, top)
  else held.scrollport.scrollTop = top
}

/**
 * Drop a pending preserve without writing (close / unmount / tests).
 * Optional `id` ignores a stale token so a newer expand is not cleared.
 * Aborted expands drop the begin() suppress window — otherwise streaming
 * floor-follow stays paused until suppressUntil, or forever when pending leaked.
 */
export function cancelExpandPreserve(id?: number | null): void {
  if (pending === null) return
  if (id != null && pending.id !== id) return
  pending = null
  suppressUntil = Math.min(suppressUntil, performance.now())
}

/**
 * Bind begin/settle to a controlled `open` flag — one path for every disclosure.
 * Pass `enabled: false` when a parent owns preserve on a shared root (process
 * group) so this hook neither begins nor cancels the module token.
 */
export function useExpandScrollPreserve(
  open: boolean,
  enabled = true,
): {
  readonly rootRef: RefObject<HTMLDivElement | null>
  /** Call immediately before flipping closed → open. */
  readonly noteExpand: () => void
} {
  const rootRef = useRef<HTMLDivElement>(null)
  const preserveIdRef = useRef<number | null>(null)

  const noteExpand = (): void => {
    if (!enabled) return
    const root = rootRef.current
    if (root === null) return
    preserveIdRef.current = beginExpandPreserve(root)
  }

  useLayoutEffect(() => {
    if (!enabled) return
    if (!open) {
      const id = preserveIdRef.current
      preserveIdRef.current = null
      // Close / abort before settle: clear module pending so follow is not stuck.
      if (id !== null) cancelExpandPreserve(id)
      return
    }
    const id = preserveIdRef.current
    if (id === null) return
    // Settle in this layout pass: the open body is already committed. A deferred
    // rAF used to leak `pending` when cleanup cancelled the frame (Strict Mode
    // remount, or open flipped false before paint) and permanently suppressed
    // ChatView floor-follow for the rest of the session.
    settleExpandPreserve(id)
    preserveIdRef.current = null
  }, [open, enabled])

  // noteExpand without a following open=true (unmount mid-gesture) must not
  // leave module `pending` latched for the rest of the session.
  useLayoutEffect(() => {
    if (!enabled) return
    return () => {
      const id = preserveIdRef.current
      preserveIdRef.current = null
      if (id !== null) cancelExpandPreserve(id)
    }
  }, [enabled])

  return { rootRef, noteExpand }
}
