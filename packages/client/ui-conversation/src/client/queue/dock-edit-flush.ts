/**
 * Session-scoped bridge so Ctrl+Enter queue flush can commit an open QueueDock
 * inline edit before Host steer. Without this, an unsaved dock draft is dropped
 * while steer still ships the pre-edit admit body.
 */

type FlushFn = () => Promise<'flushed' | 'idle' | 'failed'>

const flushBySession = new Map<string, FlushFn>()

/** Register (or clear) the dock's flush hook for one session. */
export function registerQueueDockEditFlush(
  sessionId: string,
  flush: FlushFn | null,
): void {
  if (flush === null) {
    flushBySession.delete(sessionId)
    return
  }
  flushBySession.set(sessionId, flush)
}

/**
 * Commit any open dock edit for this session before a steer flush.
 * @returns `flushed` when an edit was saved, `idle` when none was open,
 *   `failed` when save did not clear the editor (caller must abort steer).
 */
export async function flushQueueDockEdit(
  sessionId: string,
): Promise<'flushed' | 'idle' | 'failed'> {
  const flush = flushBySession.get(sessionId)
  if (flush === undefined) return 'idle'
  return flush()
}
