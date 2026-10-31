/**
 * Shared truncate / optional rollback / optional re-prompt after the
 * user confirms regenerate, edit-resubmit, or delete (Cursor-style, same session).
 *
 * Truncate uses exclusive `beforeSeq = seq - 1`, so the row at `seq` and
 * everything after it are dropped; re-prompt (when `text` is set) resends.
 *
 * Targets differ; confirm+execute is one path (copy via `kind` only):
 * - regenerate → turn-opening `user` (never mid-turn `steering` / 插话)
 * - edit → that same opener, or a step-injected `steering` 插话
 */
import type {
  ConversationSnapshot, ISessions, SessionId,
} from '@xrkseek/client-runtime/client'
import { requestResubmitConfirm } from './resubmit-intent.ts'

/**
 * Run `/rollback seq:N` and say why the files could not be restored, or
 * `undefined` when they were.
 *
 * `/rollback` reports its failures in the result rather than throwing, so a
 * bare `.catch(() => undefined)` collapsed "this face has no such command" and
 * "that checkpoint is gone" into the same silent no-op — and the caller then
 * truncated the conversation regardless.
 */
async function rollbackFailure(
  session: {
    command(line: string): Promise<
      | { readonly ok: true; readonly value: { readonly matched: boolean } }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
  },
  seq: number,
): Promise<string | undefined> {
  try {
    const result = await session.command(`/rollback seq:${seq}`)
    if (!result.ok) return result.error.message
    if (!result.value.matched) return "the face has no /rollback command"
    return undefined
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

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
 * One confirm+execute path for regenerate and edit-resubmit.
 * Regenerate (turn opener) always asks keep/revert. Edit (opener or 插话)
 * asks when live or when anything follows `seq`; else keep-files + run.
 *
 * @returns `'cancel'` when the user dismisses; `'done'` after truncate(+prompt).
 */
export async function confirmAndExecuteResubmit(
  sessions: ISessions,
  opts: {
    readonly sessionId: SessionId
    readonly seq: number
    readonly text: string
    readonly kind: 'edit' | 'regenerate'
  },
): Promise<'done' | 'cancel'> {
  const snapshot = sessions.binding(opts.sessionId)?.session?.getSnapshot()
  const needsConfirm = opts.kind === 'regenerate'
    || editResubmitNeedsConfirm(snapshot, opts.seq)
  const choice = needsConfirm
    ? await requestResubmitConfirm({
      sessionId: opts.sessionId,
      kind: opts.kind,
      seq: opts.seq,
      text: opts.text,
    })
    : 'keep-files'
  if (choice === 'cancel') return 'cancel'
  await executeResubmitAfterChoice(sessions, opts.sessionId, {
    seq: opts.seq,
    choice,
    text: opts.text,
  })
  return 'done'
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
  if (opts.choice === 'revert-files' && source !== undefined) {
    // `/rollback` finds the checkpoint by the PRE-truncate seq, so it has to run
    // first. If it fails, stop here: continuing would cut the conversation while
    // the files stayed where they were, and the user would be told neither half.
    const failure = await rollbackFailure(source, opts.seq)
    if (failure !== undefined) {
      source.reportError('resubmit', {
        code: 'internal',
        message: `文件没有回退，对话保持原样：${failure}`,
        details: {},
      })
      return
    }
  }
  // Face session.truncate cancels an active drain itself — skip a separate
  // cancel RPC so regenerate / edit-resubmit is one round trip + prompt.
  // Face beforeSeq is exclusive; Face then drops the open turn whose
  // `turn/start` sits before this user row.
  const beforeSeq = Math.max(0, Math.floor(opts.seq) - 1)
  // ISessions.truncate is Promise<void>: success resolves, business/transport
  // failures throw. Do not read `.ok` on the return (it is undefined → toast
  // "Cannot read properties of undefined (reading 'ok')").
  try {
    await sessions.truncate({ sessionId, beforeSeq })
  } catch (error: unknown) {
    sessions.binding(sessionId)?.session?.reportError('resubmit', {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    })
    return
  }
  if (opts.text === undefined) return
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) {
    throw new Error(`edit-resubmit session "${sessionId}" is not locally addressable`)
  }
  await session.prompt([{ type: 'text', text: opts.text }], 'queue')
}
