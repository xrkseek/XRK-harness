/**
 * Shared truncate / optional rollback / optional re-prompt after the
 * user confirms a past-message edit or delete (Cursor-style, same session).
 */
import type {
  ConversationSnapshot, ISessions, SessionId,
} from '@xrkseek/client-runtime/client'

/** True when the loaded chat window has any node after `seq`. */
export function chatHasEventsAfterSeq(
  snapshot: ConversationSnapshot,
  seq: number,
): boolean {
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node === undefined) continue
    if (node.anchorSeq > seq) return true
    const nodeSeq = (node.data as { readonly seq?: unknown }).seq
    if (typeof nodeSeq === 'number' && nodeSeq > seq) return true
  }
  return false
}

/**
 * Whether edit-resubmit should ask about truncate / file revert.
 * Live turns count even before durable later nodes land (inject / pre-token /
 * streaming Think), because tools may already have written the workspace.
 */
export function editResubmitSourceIsLive(
  snapshot: ConversationSnapshot | undefined,
): boolean {
  if (snapshot === undefined) return false
  return snapshot.running
    || snapshot.runningCalls.length > 0
    || snapshot.partial !== null
}

export function editResubmitNeedsConfirm(
  snapshot: ConversationSnapshot | undefined,
  seq: number,
): boolean {
  if (editResubmitSourceIsLive(snapshot)) return true
  if (snapshot === undefined) return false
  return chatHasEventsAfterSeq(snapshot, seq)
}

/**
 * After keep/revert: truncate in place before the message, stop a still-
 * running turn (Face truncate also cancels), then re-prompt (edit path).
 * Delete path omits `text`. Stays on the same sessionId.
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
  const source = sessions.binding(sessionId)?.session
  const sourceLive = editResubmitSourceIsLive(source?.getSnapshot())
  if (opts.choice === 'revert-files' && source !== undefined) {
    await source.command(`/rollback seq:${opts.seq}`).catch(() => undefined)
  }
  // Stop a live turn before the cut so an interrupted turn/end cannot land
  // after truncate (Face also cancels when active).
  if (sourceLive && source !== undefined) {
    await source.cancel().catch(() => undefined)
  }
  // Face beforeSeq is exclusive; Face then drops the open turn whose
  // `turn/start` sits before this user row.
  const beforeSeq = Math.max(0, Math.floor(opts.seq) - 1)
  await sessions.truncate({ sessionId, beforeSeq })
  if (opts.text === undefined) return
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) {
    throw new Error(`edit-resubmit session "${sessionId}" is not locally addressable`)
  }
  await session.prompt([{ type: 'text', text: opts.text }], 'queue')
}
