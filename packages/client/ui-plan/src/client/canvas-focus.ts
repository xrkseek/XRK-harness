/**
 * Soft face: open a workspace Canvas in Overview (tool card / Host nudge).
 * Mirrors `changesReview` — no hard dependency from other plugins.
 */

export type CanvasFocusSnapshot = {
  readonly sessionId: string
  readonly id: string
  readonly revision: number
}

let snapshot: CanvasFocusSnapshot | null = null
let revision = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Soft-open Overview → Canvas tab on `id` for `sessionId`. */
export function openCanvasInOverview(sessionId: string, id: string): void {
  const sid = sessionId.trim()
  const canvasId = id.trim()
  if (!sid || !canvasId) return
  revision += 1
  snapshot = { sessionId: sid, id: canvasId, revision }
  emit()
}

export function getCanvasFocusSnapshot(): CanvasFocusSnapshot | null {
  return snapshot
}

export function subscribeCanvasFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test-only reset. */
export function resetCanvasFocusForTests(): void {
  snapshot = null
  revision = 0
}
