/**
 * Shared truncate / optional rollback / fork / optional re-prompt after the
 * user confirms a past-message edit or delete.
 */
import type {
  ConversationSnapshot, ISessions, SessionId,
} from '@xrkseek/client-runtime/client'

/** True when the loaded chat window has any node with seq after `seq`. */
export function chatHasEventsAfterSeq(
  snapshot: ConversationSnapshot,
  seq: number,
): boolean {
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node === undefined) continue
    const nodeSeq = (node.data as { readonly seq?: unknown }).seq
    if (typeof nodeSeq === 'number' && nodeSeq > seq) return true
  }
  return false
}

/**
 * After keep/revert: optional file rollback, fork before the message, open the
 * child, and optionally re-prompt (edit path).
 */
export async function executeResubmitAfterChoice(
  sessions: ISessions,
  sessionId: SessionId,
  opts: {
    readonly seq: number
    readonly choice: 'keep-files' | 'revert-files'
    readonly text?: string
  },
): Promise<void> {
  if (opts.choice === 'revert-files') {
    const session = sessions.binding(sessionId)?.session
    if (session !== undefined) {
      await session.command(`/rollback seq:${opts.seq}`).catch(() => undefined)
    }
  }
  // Face beforeSeq is an exclusive log offset; wire seq is 1-based.
  const beforeSeq = Math.max(0, Math.floor(opts.seq) - 1)
  const childId = await sessions.fork({
    sessionId, beforeSeq, increaseTitle: true,
  })
  await sessions.open(childId)
  if (opts.text === undefined) return
  const child = sessions.binding(childId)?.session
  if (child === undefined) return
  await child.prompt([{ type: 'text', text: opts.text }], 'queue')
}
