/**
 * ConversationRoot shell equality: keep the previous ConversationSnapshot
 * selection across streaming flushes so the resident skeleton (composer bar,
 * docks, width chrome) does not re-render at animation-frame cadence.
 *
 * Dock / ChatView / InputBar subscribe to the fields they need themselves.
 * Chain takeover selectors only read running / subagent / pending here.
 */
import type { ConversationSnapshot } from '@xrkseek/client-runtime/client'

/**
 * Whether two snapshots are equal for ConversationRoot's own render deps.
 * @param a - previous selected snapshot (may be undefined while no session).
 * @param b - next snapshot from the store.
 * @returns true when Root can keep rendering the previous selection.
 */
export function conversationShellEqual(
  a: ConversationSnapshot | undefined,
  b: ConversationSnapshot | undefined,
): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return a.sessionId === b.sessionId
    && a.openState === b.openState
    && a.composerPhase === b.composerPhase
    && a.blank === b.blank
    && a.running === b.running
    && a.subagent === b.subagent
    && a.pending === b.pending
}
