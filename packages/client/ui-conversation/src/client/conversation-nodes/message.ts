import type { Context } from '@xrkseek/cordis'
import type {
  ContextMessageNode, ConversationNodeDefinition, SteeringMessageNode, UserMessageNode,
} from '@xrkseek/client-runtime/client'
import {
  contextForm, contextProvenance, isAppendSurfaceEvent, isReplacementSurfaceEvent,
} from '@xrkseek/client-runtime/client'
import type { InboxState } from './inbox.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode, contextLocation } from './common.ts'

interface ReferencedUserMessageNode extends UserMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

interface ReferencedSteeringMessageNode extends SteeringMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | ContextMessageNode

declare module '@xrkseek/client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Ordinary turn-opening user message. */
    user: ReferencedUserMessageNode
    /** User message admitted into an active turn. */
    steering: ReferencedSteeringMessageNode
    /** Non-user context injected into model history. */
    context: ContextMessageNode
  }
}

function isCompactionCheckpoint(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return false
  const source = event.data.source
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/** User, steering, and injected-context message classification Definition. */
export const messageDefinition: ConversationNodeDefinition<MessageNode> = {
  kind: 'input-message',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && !isCompactionCheckpoint(event)
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'user/message') throw new Error('input-message start requires user/message')
    const event = match.event
    if (event.data.source.kind !== 'user') {
      return {
        kind: 'context',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        provenance: contextProvenance(event.data.source),
        form: contextForm(event.data.source),
      }
    }
    const claimed = reader.previous<InboxState>('inbox-next-step')?.state.claimed.has(String(event.data.id)) === true
    // Claim at turn entry (turn location, no steps yet) is the next send.
    // Claim on a step, a session-located prepend, or a turn that already has
    // steps is mid-turn steer (「插队中」).
    const loc = match.location
    const turnEntry = loc.kind === 'turn' && loc.turn.steps.length === 0
    const midTurn = claimed && !turnEntry
    const rpcIds = Array.isArray((event.data as { rpcIds?: unknown }).rpcIds)
      ? (event.data as { rpcIds: readonly unknown[] }).rpcIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined
    const echoIds = rpcIds !== undefined && rpcIds.length > 0 ? { rpcIds } : {}
    return midTurn
      ? {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        ...echoIds,
      }
      : {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        ...echoIds,
      }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    // DSH chat-visibility: ordinary inject/recall stays model-visible in the
    // log but off transcript chrome. Tool inventory notices (`notice` /
    // `catalog`) keep their disclosure row; fragments / instructions / recall
    // bodies fold onto user bubbles or stay hidden.
    const hideContextChrome = context.state.kind === 'context'
      && context.state.form !== 'notice'
      && context.state.form !== 'catalog'
    const loc = contextLocation(context)
    // A closed-turn steer belongs after that turn's tail, not between the
    // answer and the footer.
    let anchor = context.state.seq
    if (context.state.kind === 'steering'
      && (loc.kind === 'turn' || loc.kind === 'step')
      && loc.turn.status === 'closed'
      && loc.turn.end !== undefined) {
      anchor = loc.turn.end.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.finalizedFollowup
    }
    return chatNode(
      context,
      context.state.kind,
      anchor,
      context.state,
      hideContextChrome ? { visibility: 'hidden' } : {},
    )
  },
}

/**
 * Register the user, steering, and injected-context message contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerMessageConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(messageDefinition)
}
