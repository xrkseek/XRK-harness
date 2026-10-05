import type { Context } from '@xrkseek/cordis'
import type {
  ConversationNodeDefinition, ConversationPreviousContext,
} from '@xrkseek/client-runtime/client'
import type { InboxTarget } from '@xrkseek/xrk-agent/types'

interface InboxIdentity {
  readonly id: string
  /** Prompt echo id (Face `user/message` stamps it on promote). */
  readonly source?: { readonly rpcId?: unknown }
}

/**
 * Durable-identity keys for one transient inbox occurrence.
 *
 * The Host queue row is keyed by `admitId`, but the promoted `user/message`
 * carries a freshly minted `messageId` (`umsg_<uuid>`) and echoes the *prompt
 * rpcId* instead. Matching on `id` alone therefore never recognized a steer
 * claim, so a durable steering row always rendered as an ordinary user
 * message. Both keys must index the claimed set.
 */
function identityKeys(identity: InboxIdentity): readonly string[] {
  const rpcId = identity.source?.rpcId
  return typeof rpcId === 'string' && rpcId !== '' && rpcId !== identity.id
    ? [identity.id, rpcId]
    : [identity.id]
}

interface InboxSplice {
  readonly target: InboxTarget
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly InboxIdentity[]
  readonly outcome?: 'canceled'
}

/** Cumulative state after one durable inbox splice. */
export interface InboxState {
  readonly pending: readonly InboxIdentity[]
  readonly claimed: ReadonlySet<string>
}

function applySplice(
  previous: ConversationPreviousContext<InboxState> | undefined,
  splice: InboxSplice,
): InboxState {
  const pending = [...(previous?.state.pending ?? [])]
  const claimed = new Set(previous?.state.claimed ?? [])
  const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  for (const identity of splice.inserted) {
    for (const key of identityKeys(identity)) claimed.delete(key)
  }
  if (splice.target === 'next-step' && splice.outcome !== 'canceled') {
    // Index the claim under every durable key: the Host queue row answers to
    // `admitId`, the promoted `user/message` to its minted `messageId` /
    // echoed prompt rpcId. A claim keyed under only one of them is invisible
    // to the message classifier and silently degrades to an ordinary send.
    for (const identity of removed) {
      for (const key of identityKeys(identity)) claimed.add(key)
    }
  }
  return { pending, claimed }
}

function inboxDefinition(target: InboxTarget): ConversationNodeDefinition<InboxState> {
  const kind = `inbox-${target}`
  return {
    kind,
    match: event => event.type === 'agent/inbox/spliced'
      && event.data.target === target
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      if (match.event.type !== 'agent/inbox/spliced') throw new Error(`${kind} start requires agent/inbox/spliced`)
      return applySplice(reader.previous<InboxState>(kind), match.event.data)
    },
    update: context => context.state,
    publication: () => 'none',
  }
}

/** Cumulative next-turn inbox splice Definition. */
export const nextTurnInboxDefinition = inboxDefinition('next-turn')

/** Cumulative next-step inbox splice Definition used to classify steering. */
export const nextStepInboxDefinition = inboxDefinition('next-step')

/**
 * Register the two durable Inbox-state contributions.
 * @param ctx - owning UI Conversation context.
 */
export function registerInboxConversationNodes(ctx: Context): void {
  ctx.conversationEvents.register(nextTurnInboxDefinition)
  ctx.conversationEvents.register(nextStepInboxDefinition)
}
