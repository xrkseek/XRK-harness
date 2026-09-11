/**
 * One Session's feedback surface: message-feedback object layer + dialog.
 */

import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import type { RemoteResult } from '@xrkseek/xrk-typert-protocol'
import { MessageFeedbackController, type MessageFeedbackActionResult } from './controller.ts'
import {
  FeedbackDialogController,
  type FeedbackCategory,
  type FeedbackRecord,
} from './dialog.ts'

/** Face `sessionFeedback.record` Typert envelope (nested business ok). */
type SessionFeedbackRecordResult =
  | { readonly ok: true; readonly value: { readonly recorded: true; readonly sliceId?: string } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message?: string } }

interface SessionFeedbackRemote {
  record: (request: {
    sessionId: SessionId
    text?: string
    category?: FeedbackCategory
  }) => Promise<RemoteResult<SessionFeedbackRecordResult>>
}

function describe(code: string): string {
  if (code === 'session-not-found') return 'session not found'
  return code
}

/** The per-session pair behind every entry of one Session. */
export class FeedbackSurface {
  readonly feedback: MessageFeedbackController
  readonly dialog: FeedbackDialogController

  constructor(private readonly ctx: ClientContext, private readonly sessionId: SessionId) {
    this.feedback = new MessageFeedbackController(ctx.remote.messageFeedback, sessionId)
    this.dialog = new FeedbackDialogController((target, entry) =>
      target.kind === 'message'
        ? this.feedback.rate(target.messageId, 'negative', formatNote(entry))
        : this.recordSession(entry))
  }

  private async recordSession(entry: FeedbackRecord): Promise<MessageFeedbackActionResult> {
    const remote = (this.ctx.remote as { sessionFeedback?: SessionFeedbackRemote }).sessionFeedback
    if (remote === undefined) {
      return { ok: false, error: { code: 'unavailable', message: 'sessionFeedback remote is unavailable' } }
    }
    const carried = await remote.record({ sessionId: this.sessionId, ...entry })
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    if (carried.value.ok) return { ok: true }
    return {
      ok: false,
      error: { code: carried.value.error.code, message: describe(carried.value.error.code) },
    }
  }

  dispose(): void {
    this.feedback.dispose()
    this.dialog.dispose()
  }
}

function formatNote(entry: FeedbackRecord): string | undefined {
  const parts = [entry.category, entry.text].filter(Boolean)
  return parts.length > 0 ? parts.join(': ') : undefined
}
