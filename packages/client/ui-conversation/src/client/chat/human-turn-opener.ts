import { isHumanOwnedUserMessage } from '@xrkseek/client-runtime/client'
import {
  userMessageHasMedia,
  userMessageText,
} from './user-message-media.ts'

export interface HumanTurnOpener {
  readonly seq: number
  readonly text: string
  /** Original content blocks (text + durable media) for regenerate re-admit. */
  readonly content: readonly unknown[]
}

/**
 * First human-owned turn opener in a turn's chat keys.
 * Seat / auto-continue openers are model-visible speech but not 老板-owned —
 * regenerate must not re-admit them as `kind:user`.
 * Attachment-only openers count (text may be empty).
 */
export function humanTurnOpenerForRegenerate(
  nodes: readonly {
    readonly kind: string
    readonly data: {
      readonly seq: number
      readonly content: unknown
      readonly source?: unknown
    }
  }[],
): HumanTurnOpener | null {
  for (const candidate of nodes) {
    if (candidate.kind !== 'user') continue
    if (!isHumanOwnedUserMessage(candidate.data.source)) continue
    const content = Array.isArray(candidate.data.content)
      ? candidate.data.content as readonly unknown[]
      : []
    const text = userMessageText(content)
    if (text.trim() === '' && !userMessageHasMedia(content)) continue
    return { seq: candidate.data.seq, text, content }
  }
  return null
}
