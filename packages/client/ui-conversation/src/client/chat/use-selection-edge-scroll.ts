/**
 * Edge-scroll the conversation scrollport while the user is *dragging* a
 * text selection into its top/bottom band. Nested overflow + mobile
 * selection handles do not get the document body's native auto-scroll.
 *
 * Idle selections (after Copy / long-press menu / handle release) must not
 * drive the port — a multi-line highlight whose union box crosses both
 * edges used to whip the transcript to the top or floor on a light flick.
 *
 * Direction follows the line box nearest the pointer, not the selection
 * union. Writes go through ChatView's observed-top ledger so stick-to-bottom
 * does not treat the step as a reader flick (or snap the floor).
 */
import { useEffect } from 'react'
import { writeConversationScroll } from '@xrkseek/client-ui-primitives'

/** Band inside the port that arms scroll (fine / coarse). */
const EDGE_FINE_PX = 40
const EDGE_COARSE_PX = 56
/** Per-frame step range (px). Caps ≈ 600–840 px/s at 60fps — readable, not a whip. */
const STEP_MIN_PX = 3
const STEP_MAX_FINE_PX = 10
const STEP_MAX_COARSE_PX = 14
/** Ignore tiny moves so a pan past an idle highlight does not arm edge-scroll. */
const ARM_SLOP_PX = 10
/** Hit padding around the selection for "started on the highlight". */
const HIT_PAD_PX = 28

function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/** Module latch: ChatView skips floor-follow while a selection drag is armed. */
let selectionGestureActive = false

/** True while a selection edge-scroll gesture owns the conversation scrollport. */
export function isSelectionScrollGestureActive(): boolean {
  return selectionGestureActive
}

function setGestureActive(next: boolean): void {
  selectionGestureActive = next
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

/** Non-empty per-line boxes for the live selection. */
function selectionLineRects(selection: Selection): DOMRect[] {
  if (selection.rangeCount === 0) return []
  try {
    return Array.from(selection.getRangeAt(0).getClientRects()).filter(
      (box) => box.width > 0 || box.height > 0,
    )
  } catch {
    return []
  }
}

/**
 * Line box nearest the pointer (or the only line). Falls back to the union
 * when the engine exposes no client rects.
 */
export function selectionAnchorBounds(
  selection: Selection,
  pointer: { readonly x: number; readonly y: number } | null,
): { top: number; bottom: number } | null {
  const lines = selectionLineRects(selection)
  if (lines.length > 0) {
    if (pointer === null) {
      const first = lines[0]!
      const last = lines[lines.length - 1]!
      return { top: first.top, bottom: last.bottom }
    }
    let best = lines[0]!
    let bestDist = Number.POSITIVE_INFINITY
    for (const box of lines) {
      const cx = Math.min(Math.max(pointer.x, box.left), box.right)
      const cy = Math.min(Math.max(pointer.y, box.top), box.bottom)
      const dx = cx - pointer.x
      const dy = cy - pointer.y
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = box
      }
    }
    return { top: best.top, bottom: best.bottom }
  }
  try {
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return null
    return { top: rect.top, bottom: rect.bottom }
  } catch {
    return null
  }
}

/** Whether `(x,y)` sits on/near any live selection line (handle / highlight). */
export function pointerNearSelection(
  selection: Selection,
  x: number,
  y: number,
  pad = HIT_PAD_PX,
): boolean {
  const lines = selectionLineRects(selection)
  if (lines.length > 0) {
    return lines.some(
      (box) =>
        x >= box.left - pad
        && x <= box.right + pad
        && y >= box.top - pad
        && y <= box.bottom + pad,
    )
  }
  try {
    const box = selection.getRangeAt(0).getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return false
    return (
      x >= box.left - pad
      && x <= box.right + pad
      && y >= box.top - pad
      && y <= box.bottom + pad
    )
  } catch {
    return false
  }
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
 * Signed scroll step for one evaluate pass, or 0 when idle / out of band.
 * Exported for unit tests (direction + idle gating without RAF).
 */
export function selectionEdgeScrollDelta(options: {
  readonly portTop: number
  readonly portBottom: number
  readonly bounds: { readonly top: number; readonly bottom: number }
  readonly coarse: boolean
}): number {
  const edge = options.coarse ? EDGE_COARSE_PX : EDGE_FINE_PX
  const maxStep = options.coarse ? STEP_MAX_COARSE_PX : STEP_MAX_FINE_PX
  const topDepth = options.portTop + edge - options.bounds.top
  const bottomDepth = options.bounds.bottom - (options.portBottom - edge)
  if (topDepth > 0 && bottomDepth > 0) {
    // Line straddles both bands (short viewport / fat line): pick the deeper rim.
    return topDepth >= bottomDepth
      ? -selectionEdgeStep(topDepth, edge, maxStep)
      : selectionEdgeStep(bottomDepth, edge, maxStep)
  }
  if (topDepth > 0) return -selectionEdgeStep(topDepth, edge, maxStep)
  if (bottomDepth > 0) return selectionEdgeStep(bottomDepth, edge, maxStep)
  return 0
}

/**
 * Drive proximity edge-scroll on `getScroller` only while a pointer is dragging
 * a selection (not while panning past an idle leftover highlight).
 */
export function useSelectionEdgeScroll(getScroller: () => HTMLElement | null): void {
  useEffect(() => {
    let raf = 0
    let step = 0
    /** Primary buttons currently held (supports multi-touch without ghosting). */
    const held = new Set<number>()
    let pointer: { x: number; y: number } | null = null
    let downX = 0
    let downY = 0
    /** Finger started on/near the highlight — handle drag, not a page pan. */
    let startedOnSelection = false
    /** Selection changed after pointerdown (extending / shrinking). */
    let selectionMutated = false
    /** Past slop + (on-selection or mutated) — edge-scroll may run. */
    let armed = false
    let selectionAtDown = ''

    const stop = (): void => {
      step = 0
      setGestureActive(false)
      if (raf !== 0) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const clearGesture = (): void => {
      armed = false
      startedOnSelection = false
      selectionMutated = false
      selectionAtDown = ''
      pointer = null
      stop()
    }

    const frame = (): void => {
      raf = 0
      if (step === 0 || held.size === 0 || !armed) {
        stop()
        return
      }
      const scroller = getScroller()
      if (scroller === null) {
        stop()
        return
      }
      const before = scroller.scrollTop
      writeConversationScroll(scroller, before + step)
      if (scroller.scrollTop === before) {
        stop()
        return
      }
      setGestureActive(true)
      raf = requestAnimationFrame(frame)
    }

    const evaluate = (): void => {
      if (held.size === 0 || !armed) {
        if (held.size === 0) stop()
        return
      }
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
      const bounds = selectionAnchorBounds(selection, pointer)
      if (bounds === null) {
        stop()
        return
      }
      const port = scroller.getBoundingClientRect()
      const next = selectionEdgeScrollDelta({
        portTop: port.top,
        portBottom: port.bottom,
        bounds,
        coarse: coarsePointer(),
      })
      if (next === 0) {
        stop()
        return
      }
      step = next
      setGestureActive(true)
      if (raf === 0) raf = requestAnimationFrame(frame)
    }

    const tryArm = (): void => {
      if (armed || pointer === null) return
      const dx = pointer.x - downX
      const dy = pointer.y - downY
      if (dx * dx + dy * dy < ARM_SLOP_PX * ARM_SLOP_PX) return
      if (!startedOnSelection && !selectionMutated) return
      armed = true
      evaluate()
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType !== 'touch') return
      held.add(event.pointerId)
      downX = event.clientX
      downY = event.clientY
      pointer = { x: event.clientX, y: event.clientY }
      armed = false
      selectionMutated = false
      const selection = window.getSelection()
      selectionAtDown = selection?.toString() ?? ''
      startedOnSelection = selection !== null
        && !selection.isCollapsed
        && pointerNearSelection(selection, event.clientX, event.clientY)
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!held.has(event.pointerId)) return
      pointer = { x: event.clientX, y: event.clientY }
      tryArm()
      if (armed) evaluate()
    }
    const onPointerUp = (event: PointerEvent): void => {
      held.delete(event.pointerId)
      if (held.size === 0) clearGesture()
    }
    const onSelectionChange = (): void => {
      if (held.size === 0) return
      const live = window.getSelection()?.toString() ?? ''
      if (live !== selectionAtDown) selectionMutated = true
      tryArm()
      if (armed) evaluate()
    }

    // Tab blur / backgrounding can drop the up without pointercancel; a stuck
    // gesture latch would suppress ChatView floor-follow for the rest of the
    // session (streaming growth never re-pins).
    const onLostPointer = (): void => {
      if (held.size === 0) return
      held.clear()
      clearGesture()
    }
    const onVisibility = (): void => {
      if (!document.hidden) return
      onLostPointer()
    }

    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerup', onPointerUp, { passive: true })
    document.addEventListener('pointercancel', onPointerUp, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('blur', onLostPointer)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('blur', onLostPointer)
      document.removeEventListener('visibilitychange', onVisibility)
      clearGesture()
    }
  }, [getScroller])
}
