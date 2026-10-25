/**
 * Fold orchestration for one process run.
 *
 * DSH keeps this apart from the group chrome (`InputFoldDriver` owns measure →
 * compensate → settle; the seat only renders). XRK needs the same split for the
 * same reason: the fold has to measure the run *before* the DOM changes, then
 * give the lost height back to `scrollTop` *after* the commit, and that pair of
 * measurements has nothing to do with what a header looks like.
 *
 * What it deliberately does NOT do, unlike DSH's driver:
 * - no spacer/padding phase — XRK's flow uses flex `gap` and a grid-row
 *   transition, so there is no margin to grow; the fold is one height change.
 * - no frame-by-frame animation of `scrollTop` — a run above the reading line
 *   folds without the transition and restores the offset in the same commit
 *   (`data-instant`), because a CSS-animated height cannot be compensated per
 *   frame from React. A run the reader can see keeps the transition instead.
 *
 * Auto-fold policy (work-details modes with `foldCompletedTurns`):
 * once the owning seat reports the run settled (tools burst done, Turn
 * closed, or session idle), the run latches closed. A later tool burst on
 * the same seat clears that latch. Floor-follow and above-viewport runs fold
 * instantly (no height transition) so the sticky composer never rides a
 * mid-animation short content height. An on-screen run away from the floor
 * keeps the transition so the answer does not jump.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Scrollport owning an element; the same attribute ChatView's scroll code reads. */
export function scrollerOf(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>('[data-conversation-scroll]')
}

/** The reading position to restore once a fold above the reader has landed. */
interface PendingCopy {
  /** The run's lower edge: a fold only ever lifts that edge. */
  readonly bottom: number
  readonly scrollport: HTMLElement
}

/** Which `data-` attribute carries the one-frame "skip the transition" flag. */
const INSTANT_ATTR = 'instant'

export interface FoldDriverOptions {
  /** Whether the owning Turn has closed; before that the run stays flat. */
  readonly closed: boolean
  /**
   * Whether a closed Turn may fold this run at all.
   *
   * The work-details mode decides (`verbose` never folds).
   */
  readonly foldAllowed: boolean
  /**
   * Reader was pinned to the floor when the Turn settled. Forces an instant
   * fold (no grid-row transition) so the sticky composer cannot paint mid-
   * column during the collapse.
   */
  readonly deferFold: boolean
  /** Writes `scrollTop` through the owner of the observed-top ledger. */
  readonly writeScroll?: ((scrollport: HTMLElement, top: number) => void) | undefined
  /** Called after a fold or unfold has landed in the DOM. */
  readonly onSettled?: (() => void) | undefined
}

export interface FoldDriver {
  /** Bind to the run's root element. */
  readonly rootRef: React.RefObject<HTMLDivElement>
  /** Whether the run is currently collapsed. */
  readonly folded: boolean
  /** Flip the run, honouring the compensation path. */
  readonly toggle: () => void
}

/**
 * Own one run's fold state, its latch, and its scroll compensation.
 *
 * The latch is taken once when the Turn closes: policy-allowed runs fold.
 * A later scroll never re-decides. The reader's pin (manual toggle) overrides
 * the latch for the life of the seat.
 * @param options - Turn state, policy, and the owner's ledger hooks.
 * @returns the ref to bind, the current fold state, and the toggle.
 */
export function useFoldDriver({
  closed,
  foldAllowed,
  deferFold,
  writeScroll,
  onSettled,
}: FoldDriverOptions): FoldDriver {
  const [latched, setLatched] = useState<'open' | 'closed' | null>(null)
  const [pinned, setPinned] = useState<boolean | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingCopyRef = useRef<PendingCopy | null>(null)
  const previousFoldedRef = useRef<boolean | null>(null)
  // A mode change must win over an earlier latch: when `foldAllowed` turns
  // false the run opens without waiting for the next Turn.
  const folded = pinned ?? (latched === 'closed' && foldAllowed)

  /**
   * Whether the run is inside the reader's viewport right now.
   *
   * Used only to choose animated vs instant fold — never to keep a closed
   * Turn open. Keeping it open on sight made "标准" look like it never folds.
   */
  const readableNow = useCallback((): boolean => {
    const root = rootRef.current
    if (root === null) return false
    const scrollport = scrollerOf(root)
    if (scrollport === null) return false
    const rect = root.getBoundingClientRect()
    const view = scrollport.getBoundingClientRect()
    return rect.bottom > view.top && rect.top < view.bottom
  }, [])

  /**
   * Apply a fold that lands above the reader, skipping that one transition.
   *
   * A run that shrinks entirely above the reading line drags everything below
   * it up: the reader's content moves even though he never touched it. For that
   * case only, restore the scroll offset in the same commit, so what he reads
   * stays exactly where it was.
   */
  const foldAbove = useCallback((apply: () => void): void => {
    const root = rootRef.current
    const scrollport = root === null ? null : scrollerOf(root)
    if (root === null || scrollport === null) {
      apply()
      return
    }
    const rect = root.getBoundingClientRect()
    if (rect.bottom >= scrollport.getBoundingClientRect().top) {
      apply()
      return
    }
    pendingCopyRef.current = { bottom: rect.bottom, scrollport }
    root.dataset[INSTANT_ATTR] = ''
    apply()
  }, [])

  // Runs after the folded DOM is committed, so the measured shift is the one
  // the reader would have seen.
  useLayoutEffect(() => {
    const root = rootRef.current
    // Always drop the transition override, even when no compensation was
    // staged: a stale one would silently disable every later fold animation.
    if (root !== null) delete root.dataset[INSTANT_ATTR]
    // Mount is not a fold: sampling then would overwrite the position a remount
    // just restored.
    const changed = previousFoldedRef.current !== null && previousFoldedRef.current !== folded
    previousFoldedRef.current = folded
    const pending = pendingCopyRef.current
    if (pending !== null) {
      pendingCopyRef.current = null
      if (root !== null) {
        const after = root.getBoundingClientRect()
        // The run's lower edge moves up by exactly the height it gave back, so
        // the offset that keeps the reader's content still is that same shift.
        // The base is the CURRENT offset, not the one read before the commit:
        // one Turn can close several runs at once, and each fold has to stack
        // on the compensation the previous one already applied. Clamping
        // matters for a reader already at the floor — the browser may have
        // clamped `scrollTop` when the content got shorter, and the target then
        // equals the new floor, so following survives the fold.
        const floorMax = Math.max(0, pending.scrollport.scrollHeight - pending.scrollport.clientHeight)
        const top = Math.min(
          Math.max(0, pending.scrollport.scrollTop + (after.bottom - pending.bottom)),
          floorMax,
        )
        if (writeScroll === undefined) pending.scrollport.scrollTop = top
        else writeScroll(pending.scrollport, top)
      }
    }
    if (changed) onSettled?.()
  }, [folded, writeScroll, onSettled])

  // The latch is taken before the DOM changes, so `foldAbove` still measures
  // the run at its open height.
  //
  // Do not latch `'open'` when folding is disallowed: that permanently blocks
  // a later mode / preference flip (verbose → standard) from ever folding a
  // Turn that already closed.
  //
  // When `closed` flips back to false (a new tool burst in the same Turn),
  // drop the auto-latch so the run expands again. A reader pin still wins.
  useEffect(() => {
    if (!closed) {
      if (latched === 'closed') setLatched(null)
      return
    }
    if (!foldAllowed || latched === 'closed') return
    // Floor-follow: skip the height transition. Mid-transition short content
    // lets the sticky composer paint mid-column for a few frames (input lift).
    if (deferFold) {
      const root = rootRef.current
      if (root !== null) root.dataset[INSTANT_ATTR] = ''
      setLatched('closed')
      return
    }
    // In view (not at floor): fold with the height transition.
    // Above the viewport: instant fold + scroll compensation.
    if (readableNow()) setLatched('closed')
    else foldAbove(() => setLatched('closed'))
  }, [closed, foldAllowed, deferFold, latched, foldAbove, readableNow])

  const toggle = useCallback((): void => {
    if (folded) setPinned(false)
    else foldAbove(() => setPinned(true))
  }, [folded, foldAbove])

  return { rootRef, folded, toggle }
}
