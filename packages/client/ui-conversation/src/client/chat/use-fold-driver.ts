/**
 * Fold orchestration for one process run.
 *
 * DSH keeps this apart from the group chrome (`InputFoldDriver` owns measure →
 * compensate → settle; the seat only renders). XRK needs the same split for the
 * same reason: the fold has to measure the run *before* the DOM changes, then
 * give the lost height back to `scrollTop` *after* the commit when the run
 * sits above the reader.
 *
 * Collapse uses `hidden="until-found"` on the body (DSH searchable-hidden) so
 * height drops in one layout — never grid-template-rows mid-heights that lift
 * the sticky composer. Floor fill is ConversationRoot's viewArea min-height.
 * In-view floor folds apply with no turn-spacer; only above-reader folds
 * compensate scrollTop.
 *
 * Auto-fold policy: once the seat reports settled, the run latches closed.
 * A later tool burst clears that latch. Mount already-settled starts folded
 * so the first paint never flashes open height.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

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

export interface FoldDriverOptions {
  /** Whether the owning Turn / process burst has settled; before that the run stays flat. */
  readonly closed: boolean
  /**
   * Whether a settled run may fold at all.
   *
   * The work-details mode decides (`verbose` never folds).
   */
  readonly foldAllowed: boolean
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
 * Own one run's fold state, its latch, and above-reader scroll compensation.
 *
 * The latch is taken once when the run settles: policy-allowed runs fold.
 * A later scroll never re-decides. The reader's pin (manual toggle) overrides
 * the latch for the life of the seat.
 * @param options - settle state, policy, and the owner's ledger hooks.
 * @returns the ref to bind, the current fold state, and the toggle.
 */
export function useFoldDriver({
  closed,
  foldAllowed,
  writeScroll,
  onSettled,
}: FoldDriverOptions): FoldDriver {
  // Mount already settled → first paint is folded (no open-height flash).
  const [latched, setLatched] = useState<'open' | 'closed' | null>(
    () => (closed && foldAllowed ? 'closed' : null),
  )
  const [pinned, setPinned] = useState<boolean | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingCopyRef = useRef<PendingCopy | null>(null)
  const previousFoldedRef = useRef<boolean | null>(null)
  // A mode change must win over an earlier latch: when `foldAllowed` turns
  // false the run opens without waiting for the next Turn.
  const folded = pinned ?? (latched === 'closed' && foldAllowed)

  /**
   * Apply a fold: above-reader → scroll compensation; in-view → plain apply
   * (floor fill is viewArea min-height, not a turn spacer).
   */
  const foldAbove = useCallback((apply: () => void): void => {
    const root = rootRef.current
    const scrollport = root === null ? null : scrollerOf(root)
    if (root === null || scrollport === null) {
      apply()
      return
    }
    const rect = root.getBoundingClientRect()
    const portTop = scrollport.getBoundingClientRect().top
    if (rect.bottom < portTop) {
      pendingCopyRef.current = { bottom: rect.bottom, scrollport }
    }
    apply()
  }, [])

  // Runs after the folded DOM is committed, so the measured shift is the one
  // the reader would have seen.
  useLayoutEffect(() => {
    const root = rootRef.current
    // Mount is not a fold: sampling then would overwrite the position a remount
    // just restored.
    const changed = previousFoldedRef.current !== null && previousFoldedRef.current !== folded
    previousFoldedRef.current = folded
    const pending = pendingCopyRef.current
    if (pending !== null) {
      pendingCopyRef.current = null
      if (root !== null) {
        const after = root.getBoundingClientRect()
        // The run's lower edge moves up by exactly the height it gave back.
        // Base is the CURRENT offset so stacked folds in one Turn compound.
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

  // Latch before paint. A post-paint effect would flash the open height first.
  //
  // Do not latch `'open'` when folding is disallowed: that permanently blocks
  // a later mode flip (verbose → standard) from ever folding a settled run.
  //
  // When `closed` flips back to false (a new tool burst), drop the auto-latch.
  // Always go through foldAbove: it no-ops compensation when the run is in
  // view, and avoids a second getBoundingClientRect before the measure.
  useLayoutEffect(() => {
    if (!closed) {
      if (latched === 'closed') setLatched(null)
      return
    }
    if (!foldAllowed || latched === 'closed') return
    foldAbove(() => setLatched('closed'))
  }, [closed, foldAllowed, latched, foldAbove])

  const toggle = useCallback((): void => {
    if (folded) setPinned(false)
    else foldAbove(() => setPinned(true))
  }, [folded, foldAbove])

  return { rootRef, folded, toggle }
}
