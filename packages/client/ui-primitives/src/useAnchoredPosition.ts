/**
 * Keep a `position:fixed` floating element anchored to a trigger.
 *
 * A portaled panel is positioned from its anchor's viewport rect, which stops
 * being true the moment anything scrolls or the window resizes. This owns that
 * one concern: measure the anchor, offset the panel below or above it, clamp
 * the result inside the viewport, and re-run on scroll (capture phase, so
 * scrollers nested inside the page are caught too), on resize, and on the
 * panel's own size changes while the element is open.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/** Default margin against the layout viewport edge. */
export const ANCHORED_VIEWPORT_MARGIN = 16

/**
 * Unplaced portal card: hidden but laid out at a fixed origin so
 * `offsetWidth` / `offsetHeight` are real on the first place() pass.
 */
export const ANCHORED_MEASURE_STYLE: CSSProperties = {
  visibility: 'hidden',
  left: 0,
  top: 0,
}

/** Inputs for {@link computeAnchoredFixedPosition}. */
export interface AnchoredFixedPositionInput {
  /** Anchor element (trigger). */
  readonly trigger: HTMLElement
  /** Floating element being placed. */
  readonly panel: HTMLElement
  /** Which anchor edge the panel hangs from. Default `bottom`. */
  readonly side?: 'top' | 'bottom'
  /**
   * Horizontal alignment: `start` = left edges (default),
   * `end` = right edges (composer trailing chips).
   */
  readonly align?: 'start' | 'end'
  /** Distance between the named anchor edge and the panel. */
  readonly gap: number
  /** Distance kept between the panel and each viewport edge. */
  readonly margin: number
  /**
   * Fallback width when `panel.offsetWidth` is still 0 (jsdom / first paint).
   * Further clamped by viewport − 2×margin.
   */
  readonly fallbackWidth?: number
  /**
   * Extra reserved width on the right (e.g. Overview details inset). Shrinks
   * the clamp ceiling so the card stays clear of a sibling chrome column.
   */
  readonly rightInset?: number
}

/**
 * Pure place+clamp for a fixed card. Shared by {@link useAnchoredPosition}
 * and call sites that re-measure outside the hook (rare).
 */
export function computeAnchoredFixedPosition(
  input: AnchoredFixedPositionInput,
): CSSProperties {
  const {
    trigger, panel, side = 'bottom', align = 'start', gap, margin, fallbackWidth,
    rightInset = 0,
  } = input
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const measuredW = panel.offsetWidth
  const width = measuredW > 0
    ? measuredW
    : fallbackWidth === undefined
      ? 0
      : Math.min(fallbackWidth, Math.max(0, vw - margin * 2))
  const height = panel.offsetHeight
  let left = align === 'end' && width > 0 ? rect.right - width : rect.left
  let top = side === 'top'
    ? (height > 0 ? rect.top - gap - height : rect.top - gap)
    : rect.bottom + gap
  if (width > 0) {
    const maxRight = vw - Math.max(0, rightInset) - margin
    left = Math.min(
      Math.max(left, margin),
      Math.max(margin, maxRight - width),
    )
  }
  if (height > 0) {
    top = Math.min(
      Math.max(top, margin),
      Math.max(margin, vh - height - margin),
    )
  }
  return { left, top }
}

/** Inputs for {@link useAnchoredPosition}. */
export interface AnchoredPositionOptions {
  /** Whether the floating element is mounted and should track its anchor. */
  open: boolean
  /** The element the panel is placed from. */
  anchorRef: RefObject<HTMLElement | null>
  /** The floating element, measured so the clamp uses real dimensions. */
  panelRef: RefObject<HTMLElement | null>
  /** Which anchor edge the panel hangs from: below it (`bottom`, the default) or above it (`top`). */
  side?: 'top' | 'bottom'
  /**
   * Horizontal alignment to the anchor: `start` = left edges (default),
   * `end` = right edges (composer trailing chips — ModelSelect / ContextMeter).
   */
  align?: 'start' | 'end'
  /** Distance kept between the anchor edge named by `side` and the panel. */
  gap: number
  /** Distance kept between the panel and each viewport edge. */
  margin: number
  /**
   * Fallback width when the panel still reports 0 (jsdom / first paint).
   * See {@link computeAnchoredFixedPosition}.
   */
  fallbackWidth?: number
  /**
   * Read once per place() — Overview inset / phone chrome that changes without
   * React state. Kept out of the effect deps (identity churn would rebind).
   */
  getRightInset?: () => number
  /** Optional per-place margin override (e.g. phone vs desktop). */
  getMargin?: () => number
}

/**
 * Track an anchor and return the panel's fixed coordinates.
 * @param options - the open state, the two refs, the placement side, and the gap/margin distances.
 * @returns `left`/`top` for the panel, or `null` before the first measurement.
 */
export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null {
  const {
    open, anchorRef, panelRef, side = 'bottom', align = 'start', gap, margin, fallbackWidth,
    getRightInset, getMargin,
  } = options
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const getRightInsetRef = useRef(getRightInset)
  getRightInsetRef.current = getRightInset
  const getMarginRef = useRef(getMargin)
  getMarginRef.current = getMargin
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      /* v8 ignore start -- geometry read from real layout: jsdom reports zero
         offset sizes, so the positive-size clamp arms are exercised by browser
         scenarios rather than unit tests. */
      const trigger = anchorRef.current
      const panel = panelRef.current
      if (trigger === null || panel === null) return
      const next = computeAnchoredFixedPosition({
        trigger,
        panel,
        side,
        align,
        gap,
        margin: getMarginRef.current?.() ?? margin,
        fallbackWidth,
        rightInset: getRightInsetRef.current?.() ?? 0,
      })
      /* v8 ignore stop */
      setPosition((prev) => (
        prev !== null
        && prev.left === next.left
        && prev.top === next.top
          ? prev
          : next
      ))
    }
    // The first run measures the panel in the same commit that opened it, so
    // the clamp uses real dimensions before anything paints.
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // The panel's own height changes without either event — a status line
    // appearing inside it, or a `resize: vertical` textarea dragged taller —
    // and a stale clamp would let a panel near the bottom edge cross the
    // margin it is supposed to respect. The guard keeps the hook usable where
    // `ResizeObserver` is absent, which is how jsdom runs.
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place)
      observer.observe(panel)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, panelRef, side, align, gap, margin, fallbackWidth])
  return position
}
