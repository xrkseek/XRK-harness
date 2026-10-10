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
    const inboxClaim = reader.previous<InboxState>('inbox-next-step')?.state.claimed
    // The transient inbox row is keyed by `admitId`, while this durable row
    // answers to a freshly minted `messageId` plus the echoed prompt rpcId(s)
    // the Host stamped on promote. Consult every durable identity: a claim
    // matched on `id` alone is empty in production (admitId ≠ `umsg_<uuid>`)
    // and silently degrades a mid-turn steer to an ordinary user message.
    const raw = event.data as { readonly rpcIds?: unknown; readonly source?: { readonly rpcId?: unknown } }
    const rpcIds = Array.isArray(raw.rpcIds)
      ? (raw.rpcIds as readonly unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    const sourceRpc = raw.source
    const durableIds = [
      String(event.data.id),
      ...rpcIds,
      ...(typeof sourceRpc?.rpcId === 'string' ? [sourceRpc.rpcId] : []),
    ]
    const claimed = inboxClaim !== undefined && durableIds.some(id => inboxClaim.has(id))
    // A claimed next-step at a brand-new turn (no step has started) is the
    // send that opens the next request. Same-turn claims after a prior step
    // — including the post-`step/end` vacuum whose Location is `turn` —
    // stay steering so Chat can park 「权衡方案中」 above 「插队中」, until
    // the Host runs the step that promotes them into the next opener.
    const loc = match.location
    const turnOpening = loc.kind === 'turn'
      && !loc.turn.steps.some(step => step.start !== undefined)
    const midTurn = claimed && !turnOpening
    const echoIds = rpcIds.length > 0 ? { rpcIds } : {}
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
    // A closed-turn steer that landed after the turn closed belongs after
    // that turn's tail. Keep event seq otherwise: a steer that opened the
    // next request must not jump past the assistant that answered it.
    let anchor = context.state.seq
    if (context.state.kind === 'steering'
      && (loc.kind === 'turn' || loc.kind === 'step')
      && loc.turn.status === 'closed'
      && loc.turn.end !== undefined
      && context.state.seq >= loc.turn.end.seq) {
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
