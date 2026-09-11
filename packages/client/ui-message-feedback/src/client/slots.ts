/**
 * The feedback entry's injected faces. Live per-message state arrives through
 * the `feedback` hook; the dialog overlay uses `dialog`.
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import type { MessageId } from '@xrkseek/client-connection/client'
import type { MessageFeedbackRating } from '@xrkseek/xrk-message-feedback/types'
import type {} from './locales.ts'
import type { MessageFeedbackActionResult, MessageFeedbackView } from './controller.ts'
import type { FeedbackDialogState } from './dialog.ts'

/** Injected business face of one assistant-message feedback entry. */
export interface MessageFeedbackInjected {
  hooks: {
    feedback: HostObservable<MessageFeedbackView>
  }
  ensure: () => Promise<MessageFeedbackActionResult>
  rate: (
    messageId: MessageId,
    rating: MessageFeedbackRating,
    note?: string,
  ) => Promise<MessageFeedbackActionResult>
  toggle: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  clearNote: (messageId: MessageId) => Promise<MessageFeedbackActionResult>
  clear: (messageId: MessageId) => Promise<MessageFeedbackActionResult>
}

export type MessageFeedbackActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<MessageFeedbackInjected>
  & PropsLocale<'feedback'>

/** Injected business face of the Session's feedback dialog entry. */
export interface FeedbackDialogInjected {
  hooks: {
    dialog: HostObservable<FeedbackDialogState>
  }
  edit: (draft: Partial<Pick<FeedbackDialogState, 'category' | 'text'>>) => void
  submit: () => Promise<void>
  dismiss: () => void
  dismissToast: (seq: number) => void
}

export type FeedbackDialogProps =
  InjectFace<FeedbackDialogInjected>
  & PropsLocale<'feedback'>
