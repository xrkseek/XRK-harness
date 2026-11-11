/**
 * The feedback dialog overlay's injected face. Per-message Like/Dislike
 * chrome was removed from assistant IconActions.
 */

import type {
  HostObservable, InjectFace, PropsLocale,
} from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import type {} from './locales.ts'
import type { FeedbackDialogState } from './dialog.ts'

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
