import type {
  ConversationLocation, ConversationNodeContext,
} from '@xrkseek/client-runtime/client'
import type {
  ChatNode, ChatNodeDataMap, ChatNodeKind,
} from '../contract/chat-nodes.ts'

/**
 * Relative positions in one durable event's seq neighborhood: interrupted
 * Assistant, its follow-up Nodes, then follow-ups to an ordinary final. The
 * max-tokens notice sits between a closing Assistant and the turn-tail so the
 * tail stays the turn's last node and keeps its branch action enabled.
 */
export const CHAT_SYNTHETIC_SEQ_OFFSETS = {
  interruptedAssistant: -0.9,
  interruptedFollowup: -0.8,
  maxTokensNotice: 0.05,
  finalizedFollowup: 0.1,
} as const

/**
 * Resolve one Context's best currently loaded event Location.
 * @param context - assembled business Context.
 * @returns start or first-match Location, otherwise unresolved.
 */
export function contextLocation(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/**
 * Build one final Chat target Node with the engine-owned stable key.
 * @param context - assembled business Context.
 * @param kind - Chat renderer dispatch key.
 * @param anchorSeq - sortable render position.
 * @param data - renderer-owned payload.
 * @param options - optional Location and visibility overrides.
 * @returns final Chat view Node.
 */
export function chatNode<Kind extends ChatNodeKind>(
  context: ConversationNodeContext,
  kind: Kind,
  anchorSeq: number,
  data: ChatNodeDataMap[Kind],
  options: {
    readonly location?: ConversationLocation
    readonly visibility?: 'visible' | 'hidden'
  } = {},
): ChatNode<Kind> {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: options.location ?? contextLocation(context),
    visibility: options.visibility ?? 'visible',
    data,
  }
}

/**
 * Read a finite non-negative integer from a structurally narrowed payload.
 * @param value - untrusted payload field.
 * @returns valid coordinate, otherwise undefined.
 */
export function coordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * User Stop / soft cancel closed this Turn (`turn/end` aborted|interrupted).
 * Shared by assistant projection (「已停止」 on the step) and turn-tail
 * (fallback marker when Stop left no assistant chrome).
 */
export function turnEndedAsStop(end: {
  readonly type?: string
  readonly data?: { readonly reason?: { readonly kind?: string; readonly reason?: { readonly kind?: string } } }
} | undefined): boolean {
  if (end?.type !== 'turn/end') return false
  const kind = end.data?.reason?.kind
  return kind === 'aborted' || kind === 'interrupted'
}

/** Nested cancel cause on `turn/end` aborted (`user` / `disposed` / …). */
export type TurnAbortCauseKind =
  | 'user'
  | 'parent'
  | 'disposed'
  | 'legacy'
  | 'hook'
  | 'interrupted'

/**
 * Durable cancel cause for Stop chrome. Crash-orphaned `interrupted` and bare
 * aborted without a nested cause read as user-facing Stop.
 */
export function turnAbortCause(end: {
  readonly type?: string
  readonly data?: {
    readonly reason?: {
      readonly kind?: string
      readonly reason?: { readonly kind?: string }
    }
  }
} | undefined): TurnAbortCauseKind | undefined {
  if (!turnEndedAsStop(end)) return undefined
  const outer = end?.data?.reason?.kind
  if (outer === 'interrupted') return 'interrupted'
  const nested = end?.data?.reason?.reason?.kind
  if (
    nested === 'user'
    || nested === 'parent'
    || nested === 'disposed'
    || nested === 'legacy'
    || nested === 'hook'
  ) {
    return nested
  }
  return 'user'
}

/** Locale key for interrupted / Stop chrome by cancel cause. */
export function stopLabelKey(cause: TurnAbortCauseKind | undefined): string {
  switch (cause) {
    case 'disposed':
      return 'message.stopped.disposed'
    case 'legacy':
      return 'message.stopped.abnormal'
    case 'parent':
      return 'message.stopped.parent'
    case 'hook':
      return 'message.stopped.hook'
    case 'interrupted':
      return 'message.stopped.interrupted'
    case 'user':
    default:
      return 'message.stopped'
  }
}
