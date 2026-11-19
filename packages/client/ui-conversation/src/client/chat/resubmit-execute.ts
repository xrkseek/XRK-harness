/**
 * Shared truncate / optional rollback / optional re-prompt after the
 * user confirms regenerate, edit-resubmit, or delete (Cursor-style, same session).
 *
 * Truncate uses exclusive Face `beforeSeq` = durable log index of the target
 * row (via {@link SessionFace.exclusiveBeforeSeqForWireSeq} — not raw
 * `muxSeq - 1`, which breaks after a monotonic mux jump post-truncate).
 * The row at that index and everything after are dropped; re-prompt
 * (when `content` / `text` is set) resends.
 *
 * A still-running turn is stopped by Face `session.truncate` (drain.cancel).
 * The client paints a local submission echo before the re-prompt so the
 * waiting line never appears alone above an empty tail.
 *
 * Targets differ; confirm+execute is one path (copy via `kind` only):
 * - regenerate → turn-opening `user` (never mid-turn `steering` / 插话)
 * - edit → that same opener, or a step-injected `steering` 插话
 */
import type {
  ConversationSnapshot, ISessions, PendingSubmissionAttachment, SessionFace, SessionId,
} from '@xrkseek/client-runtime/client'
import type { AttachmentId } from '@xrkseek/xrk-attachment'
import { requestResubmitConfirm } from './resubmit-intent.ts'

/** Wire parts for `session.prompt` after truncate (text and/or media reuse). */
type ResubmitPromptContent = Parameters<SessionFace['prompt']>[0][number]

/** Local echo painted before Host admit (avoids waiting-line-only flash). */
export type ResubmitEcho = {
  readonly text: string
  readonly attachments: readonly PendingSubmissionAttachment[]
}

/**
 * Best-effort echo from prompt wire parts when the caller did not supply one.
 * File `attachmentId` reuse keeps a durable card; image reuse needs a blob
 * preview the caller should pass via {@link ResubmitEcho}.
 */
export function echoFromPromptParts(
  parts: readonly ResubmitPromptContent[],
): ResubmitEcho {
  let text = ''
  const attachments: PendingSubmissionAttachment[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      text += part.text
      continue
    }
    if (part.type === 'file' && 'attachmentId' in part && typeof part.attachmentId === 'string') {
      attachments.push({
        type: 'file',
        value: {
          attachmentId: part.attachmentId as AttachmentId,
          name: 'file',
          bytes: 1,
        },
      })
      continue
    }
    if (part.type === 'file' && 'data' in part && typeof part.data === 'string') {
      attachments.push({
        type: 'file',
        value: {
          attachmentId: 'echo:resubmit-file' as AttachmentId,
          name: typeof part.name === 'string' && part.name !== '' ? part.name : 'file',
          bytes: Math.max(1, Math.floor((part.data.length * 3) / 4)),
          ...(typeof part.mediaType === 'string' ? { mediaType: part.mediaType } : {}),
        },
      })
    }
  }
  return { text, attachments }
}

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
    if (!result.value.matched) return 'the face has no /rollback command'
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
    /**
     * Full prompt parts after truncate. Prefer this when the opener carried
     * media — text-only would drop images/files. When omitted, `text` alone
     * is admitted (delete path / callers that re-send via sendSession).
     */
    readonly content?: readonly ResubmitPromptContent[]
    /** Optional local echo (text + media cards) painted before Host admit. */
    readonly echo?: ResubmitEcho
    /** Revoke cloned echo blob URLs when the pending submission retires. */
    readonly onEchoRetire?: (retirement: {
      readonly reason: 'observed' | 'failed'
    }) => void
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
  if (choice === 'cancel') {
    opts.onEchoRetire?.({ reason: 'failed' })
    return 'cancel'
  }
  await executeResubmitAfterChoice(sessions, opts.sessionId, {
    seq: opts.seq,
    choice,
    ...(opts.content !== undefined
      ? { content: opts.content }
      : { text: opts.text }),
    ...(opts.echo === undefined ? {} : { echo: opts.echo }),
    ...(opts.onEchoRetire === undefined ? {} : { onEchoRetire: opts.onEchoRetire }),
  })
  return 'done'
}

/**
 * After keep/revert: truncate in place before the message (Face cancel stops a
 * live drain), then re-prompt with a local echo so waiting never paints alone.
 * Delete path omits `text` / `content`. Stays on the same sessionId.
 */
export async function executeResubmitAfterChoice(
  sessions: ISessions,
  sessionId: SessionId,
  opts: {
    readonly seq: number
    readonly choice: 'keep-files' | 'revert-files'
    readonly text?: string
    readonly content?: readonly ResubmitPromptContent[]
    readonly echo?: ResubmitEcho
    readonly onEchoRetire?: (retirement: {
      readonly reason: 'observed' | 'failed'
    }) => void
  },
): Promise<void> {
  const source = sessions.binding(sessionId)?.session
  const retireEcho = (reason: 'observed' | 'failed'): void => {
    opts.onEchoRetire?.({ reason })
  }
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
      retireEcho('failed')
      return
    }
  }
  // Face session.truncate cancels an active drain itself — skip a separate
  // cancel RPC so regenerate / edit-resubmit / delete is one round trip (+ prompt).
  // Face beforeSeq is an exclusive durable-log offset; mux seq can jump above
  // the kept length after a prior truncate (monotonic FaceSeqClock).
  const beforeSeq = source?.exclusiveBeforeSeqForWireSeq(opts.seq)
    ?? Math.max(0, Math.floor(opts.seq) - 1)
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
    retireEcho('failed')
    return
  }
  const parts = opts.content
    ?? (opts.text === undefined ? undefined : [{ type: 'text' as const, text: opts.text }])
  if (parts === undefined || parts.length === 0) {
    retireEcho('failed')
    return
  }
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) {
    retireEcho('failed')
    throw new Error(`edit-resubmit session "${sessionId}" is not locally addressable`)
  }
  const echo = opts.echo ?? echoFromPromptParts(parts)
  // Paint the bubble before Host admit / running flip — same contract as sendSession.
  const submission = session.beginSubmission({
    mode: 'queue',
    text: echo.text,
    attachments: echo.attachments,
    onRetire: (retirement) => {
      if (retirement.reason === 'failed') {
        retireEcho('failed')
        return
      }
      // Keep thumbs one paint after the durable node lands (ChatView previewMemory).
      queuePromise.resolve().then(() => {
        requestAnimationFrame(() => retireEcho('observed'))
      })
    },
  })
  const result = await session.prompt([...parts], 'queue', undefined, submission.requestId)
  if (!result.ok) {
    submission.abandon()
    session.reportError('resubmit', result.error)
  }
}
