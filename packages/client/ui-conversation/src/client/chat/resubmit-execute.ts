/**
 * Shared truncate / optional rollback / fork / optional re-prompt after the
 * user confirms a past-message edit or delete.
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
 * After keep/revert: fork before the message, open the child, stop a still-
 * running original (after the cut so a cancel `turn/end` cannot enter the
 * seed), then re-prompt (edit path). Delete path omits `text`. Idle originals
 * are left alone — canceling them stamps 「已停止」 into a one-message log.
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
  // Face beforeSeq is exclusive; Face then drops the open turn whose
  // `turn/start` sits before this user row so the child cannot repair it
  // into a ghost 「已停止」.
  const beforeSeq = Math.max(0, Math.floor(opts.seq) - 1)
  const childId = await sessions.fork({
    sessionId, beforeSeq, increaseTitle: true,
  })
  await sessions.open(childId)
  // Stop leftover drain only when the original was actually live. Do this
  // after the fork cut: finalizing an open turn first would copy 「已停止」.
  if (sourceLive && source !== undefined) {
    await source.cancel().catch(() => undefined)
  }
  if (opts.text === undefined) return
  const child = sessions.binding(childId)?.session
  if (child === undefined) {
    throw new Error(`edit-resubmit child "${childId}" is not locally addressable`)
  }
  await child.prompt([{ type: 'text', text: opts.text }], 'queue')
}
