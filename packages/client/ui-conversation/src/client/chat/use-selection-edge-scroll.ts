/**
 * Edge-scroll the conversation scrollport while a text selection hugs its
 * top/bottom. Nested overflow + mobile selection handles do not get the
 * document body's native auto-scroll.
 *
 * Speed scales with how deep the selection sits in the edge band — slow at
 * entry, faster near the rim — so fine and coarse pointers both feel steady.
 */
import { useEffect } from 'react'

/** Band inside the port that arms scroll (fine / coarse). */
const EDGE_FINE_PX = 40
const EDGE_COARSE_PX = 56
/** Per-frame step range (px). Caps ≈ 600–840 px/s at 60fps — readable, not a whip. */
const STEP_MIN_PX = 3
const STEP_MAX_FINE_PX = 10
const STEP_MAX_COARSE_PX = 14

function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/** Selection's common ancestor is under the conversation scrollport. */
function selectionInside(scroller: HTMLElement, selection: Selection): boolean {
  if (selection.rangeCount === 0) return false
  const node = selection.getRangeAt(0).commonAncestorContainer
  const el = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
  return el !== null && scroller.contains(el)
}

/** Union client box of every live range (skips empty rects). */
function selectionBounds(selection: Selection): { top: number; bottom: number } | null {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let i = 0; i < selection.rangeCount; i++) {
    const rect = selection.getRangeAt(i).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null
  return { top, bottom }
}

/**
 * Ease-in step from band depth: 0 at the inner edge, max at the rim.
 * @param depth - how far past the inner edge (0…edge).
 * @param edge - band thickness.
 * @param maxStep - platform max px/frame.
 */
export function selectionEdgeStep(depth: number, edge: number, maxStep: number): number {
  const t = Math.min(1, Math.max(0, depth / edge))
  return STEP_MIN_PX + (maxStep - STEP_MIN_PX) * (t * t)
}

/**
 * Drive proximity edge-scroll on `getScroller` while a non-collapsed selection
 * sits in the top/bottom band. Idle when the selection is outside the port.
 */
export function useSelectionEdgeScroll(getScroller: () => HTMLElement | null): void {
  useEffect(() => {
    let raf = 0
    let step = 0

    const stop = (): void => {
      step = 0
      if (raf !== 0) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const frame = (): void => {
      raf = 0
      if (step === 0) return
      const scroller = getScroller()
      if (scroller === null) {
        stop()
        return
      }
      const before = scroller.scrollTop
      scroller.scrollTop = before + step
      if (scroller.scrollTop === before) {
        stop()
        return
      }
      raf = requestAnimationFrame(frame)
    }

    const evaluate = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) {
        stop()
        return
      }
      const scroller = getScroller()
      if (scroller === null || !selectionInside(scroller, selection)) {
        stop()
        return
      }
      const bounds = selectionBounds(selection)
      if (bounds === null) {
        stop()
        return
      }
      const coarse = coarsePointer()
      const edge = coarse ? EDGE_COARSE_PX : EDGE_FINE_PX
      const maxStep = coarse ? STEP_MAX_COARSE_PX : STEP_MAX_FINE_PX
      const port = scroller.getBoundingClientRect()
      const topDepth = port.top + edge - bounds.top
      const bottomDepth = bounds.bottom - (port.bottom - edge)
      let next = 0
      if (topDepth > 0) next = -selectionEdgeStep(topDepth, edge, maxStep)
      else if (bottomDepth > 0) next = selectionEdgeStep(bottomDepth, edge, maxStep)
      if (next === 0) {
        stop()
        return
      }
      step = next
      if (raf === 0) raf = requestAnimationFrame(frame)
    }

    document.addEventListener('selectionchange', evaluate)
    // Handle drags can move geometry without a selectionchange every frame.
    document.addEventListener('pointermove', evaluate, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', evaluate)
      document.removeEventListener('pointermove', evaluate)
      stop()
    }
  }, [getScroller])
}
