/**
 * Headless state of one Session's feedback dialog and acknowledgement toast.
 * One form serves the Session target (bare `/feedback`) and optional message
 * targets (Dislike). Overlay and message controls share one controller.
 */

import { createSnapshotStore, type SnapshotStore } from '@xrkseek/client-runtime/client'
import type { MessageId } from '@xrkseek/client-connection/client'
import type { MessageFeedbackActionResult } from './controller.ts'

/** Fixed product taxonomy (restated so the client bundle need not import Host). */
export type FeedbackCategory =
  | 'task-result'
  | 'instruction-following'
  | 'product-interaction'
  | 'service-stability'
  | 'resource-cost'
  | 'security-privacy-permission'
  | 'other'

export type FeedbackRecord = {
  readonly text?: string
  readonly category?: FeedbackCategory
}

/** What one open dialog submits to. */
export type FeedbackDialogTarget =
  | { readonly kind: 'session' }
  | { readonly kind: 'message'; readonly messageId: MessageId }

/** Dialog and toast state the overlay view renders from. */
export interface FeedbackDialogState {
  readonly target: FeedbackDialogTarget | null
  readonly category: FeedbackCategory | null
  readonly text: string
  readonly submitting: boolean
  readonly failure: string | null
  readonly toast: number
}

export type FeedbackSubmit = (
  target: FeedbackDialogTarget,
  entry: FeedbackRecord,
) => Promise<MessageFeedbackActionResult>

const CLOSED: Omit<FeedbackDialogState, 'toast'> = {
  target: null, category: null, text: '', submitting: false, failure: null,
}

/** Per-session dialog controller. */
export class FeedbackDialogController {
  readonly state: SnapshotStore<FeedbackDialogState> = createSnapshotStore<FeedbackDialogState>({
    ...CLOSED, toast: 0,
  })

  private generation = 0
  private toastSeq = 0

  constructor(private readonly submit: FeedbackSubmit) {}

  open(target: FeedbackDialogTarget): void {
    this.generation += 1
    this.state.set({ ...CLOSED, target, toast: this.state.getSnapshot().toast })
  }

  dismiss(): void {
    this.generation += 1
    this.state.set({ ...CLOSED, toast: this.state.getSnapshot().toast })
  }

  edit(draft: Partial<Pick<FeedbackDialogState, 'category' | 'text'>>): void {
    const s = this.state.getSnapshot()
    if (s.target === null || s.submitting) return
    this.state.set({ ...s, ...draft })
  }

  async submitDraft(): Promise<void> {
    const s = this.state.getSnapshot()
    if (s.target === null || s.submitting) return
    const generation = this.generation
    this.state.set({ ...s, submitting: true, failure: null })
    const text = s.text.trim()
    const result = await this.submit(s.target, {
      ...(text.length === 0 ? {} : { text }),
      ...(s.category === null ? {} : { category: s.category }),
    })
    if (result.ok) {
      if (generation === this.generation) this.dismiss()
      this.acknowledge()
      return
    }
    if (generation !== this.generation) return
    this.state.set({ ...this.state.getSnapshot(), submitting: false, failure: result.error.code })
  }

  acknowledge(): void {
    this.toastSeq += 1
    this.state.set({ ...this.state.getSnapshot(), toast: this.toastSeq })
  }

  dismissToast(seq: number): void {
    const s = this.state.getSnapshot()
    if (s.toast === seq) this.state.set({ ...s, toast: 0 })
  }

  dispose(): void {
    this.generation += 1
    this.state.set({ ...CLOSED, toast: 0 })
  }
}
