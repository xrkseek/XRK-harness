/**
 * Feedback surface plugin, browser half: Like/Dislike on assistant actions,
 * session feedback dialog in conversation.input.overlay, and bare `/feedback`
 * decoration that opens the dialog. Typed `/feedback <text>` stays on the Host.
 */

import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@xrkseek/xrk-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the assistant-actions and overlay entries).
import type {} from '@xrkseek/client-ui-conversation/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi).
import type {} from '@xrkseek/client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@xrkseek/client-locale/client'
import type { CommandUiContract } from '@xrkseek/client-ui-commands/client'
import { FeedbackDialog } from './FeedbackDialog.tsx'
import { MessageFeedbackActions } from './MessageFeedbackActions.tsx'
import type { FeedbackDialogInjected, MessageFeedbackInjected } from './slots.ts'
import { FeedbackSurface } from './surface.ts'
import { en, zh } from './locales.ts'

export type {
  MessageFeedbackActionResult, MessageFeedbackStatus, MessageFeedbackView, MessageFeedbackRemote,
} from './controller.ts'
export type { FeedbackDialogState, FeedbackDialogTarget, FeedbackSubmit, FeedbackCategory, FeedbackRecord } from './dialog.ts'
export type { FeedbackDialogInjected, FeedbackDialogProps, MessageFeedbackActionProps, MessageFeedbackInjected } from './slots.ts'
export type { MessageFeedbackKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'feedback'

/** Required services: slots, remotes, locale; commandUi optional for /feedback decoration. */
export const inject = ['slots', 'remote', 'remote.messageFeedback', 'locale']

/**
 * Client plugin body: per-message controls, session dialog, `/feedback` decoration.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-message-feedback: dictionaries')

  const surfaces = new Map<SessionId, FeedbackSurface>()
  const surfaceFor = (sessionId: SessionId): FeedbackSurface => {
    let surface = surfaces.get(sessionId)
    if (surface === undefined) {
      surface = new FeedbackSurface(ctx, sessionId)
      surfaces.set(sessionId, surface)
    }
    return surface
  }
  ctx.effect(() => () => {
    for (const surface of surfaces.values()) surface.dispose()
    surfaces.clear()
  }, 'ui-message-feedback: per-session surfaces')

  ctx.on('connection/reset', () => {
    for (const { feedback } of surfaces.values()) {
      if (feedback.getSnapshot().status !== 'cold') void feedback.resync()
    }
  })

  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'feedback',
      order: 10,
      locale: NS,
      inject: (sessionId): MessageFeedbackInjected => {
        const { feedback } = surfaceFor(sessionId)
        return {
          hooks: { feedback },
          ensure: () => feedback.ensure(),
          rate: (messageId, rating, note) => feedback.rate(messageId, rating, note),
          toggle: (messageId, rating) => feedback.toggle(messageId, rating),
          clearNote: messageId => feedback.clearNote(messageId),
          clear: messageId => feedback.clear(messageId),
        }
      },
    }, MessageFeedbackActions)
    return () => { dispose() }
  })

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'feedback-dialog',
    order: 2,
    locale: NS,
    inject: (sessionId): FeedbackDialogInjected => {
      const { dialog } = surfaceFor(sessionId)
      return {
        hooks: { dialog: dialog.state },
        edit: (draft) => { dialog.edit(draft) },
        submit: () => dialog.submitDraft(),
        dismiss: () => { dialog.dismiss() },
        dismissToast: (seq) => { dialog.dismissToast(seq) },
      }
    },
  }, FeedbackDialog))

  // Host keeps `/feedback <text>`; bare menu/enter opens the dialog.
  ctx.inject(['commandUi'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    scope.effect(() => command.decorate({
      name: 'feedback',
      available: () => true,
      ui: {
        kind: 'action',
        run: (session) => {
          surfaceFor(session.sessionId).dialog.open({ kind: 'session' })
        },
      },
    }), 'ui-message-feedback: /feedback decoration')
  })
}
