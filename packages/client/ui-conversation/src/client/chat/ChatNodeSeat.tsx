import { memo, useMemo } from 'react'
import type { PendingSubmission } from '@xrkseek/client-runtime/client'
import { JsonBlock } from '@xrkseek/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { PendingSubmissionBubble, userMessageHasReaderSurface } from './MessageItem.tsx'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
  /** Whole-log 轮次 by Host turn; opener paints 「第 N 轮」, 插话 paints 「第 N 轮 插话」. */
  readonly roundByTurn: ReadonlyMap<number, number>
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, roundByTurn, openFile, inspectCall, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer,
  steer, loadImage, renderMessageImages, renderMessageFiles, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      restoreAt,
      editAt,
      regenerateAt,
      deleteAt,
      withdrawSteer,
      steer,
      loadImage,
      renderMessageImages,
      renderMessageFiles,
      fileMentions,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer, steer, loadImage,
    renderMessageImages, renderMessageFiles, fileMentions,
  ])
  if (routedNode === undefined || owner === null) return null
  // Caption-only user rows (model handle text, no card) must not keep a
  // round label and an action strip — that is a second bubble per file.
  if ((routedNode.kind === 'user' || routedNode.kind === 'steering')
    && !userMessageHasReaderSurface(routedNode.data.content)) {
    return null
  }
  const location = routedNode.location
  const hostTurn = location.kind === 'turn' || location.kind === 'step'
    ? location.turn.turn
    : undefined
  // Round label may cite the Host turn for 插话, but rail jump anchors stay on
  // the opener only (`data-chat-turn` omitted for steering).
  const turn = routedNode.kind === 'steering' ? undefined : hostTurn
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  // No `data-live` grace any more: `.flowItem` stopped carrying
  // `content-visibility: auto` (ChatView.module.css:63-67 records the Chromium
  // ghost paint that forced it out), which left a per-row 480 ms settle timer
  // with no consumer — on a long transcript that was one timer plus one
  // re-render per row on every settle. Re-introducing paint containment means
  // bringing the grace back (git history: use-post-stream-live.ts).
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  const round = hostTurn === undefined ? undefined : roundByTurn.get(hostTurn)
  const roundLabelKey = routedNode.kind === 'steering'
    ? 'chat.turnNavigation.steer'
    : routedNode.kind === 'user'
      ? 'chat.turnNavigation.turn'
      : null
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-chat-round={round}
    >
      {roundLabelKey !== null && round !== undefined ? (
        <div className={css.roundLabel}>{t(roundLabelKey, { turn: round })}</div>
      ) : null}
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})

/**
 * One send row from the local echo through the durable user node.
 * Same component and key so the round label and action row stay mounted
 * when the log write replaces the echo.
 */
export const UserSendFlow = memo(function UserSendFlow({
  flowKey, nodeKey, submission, round, onWithdraw,
  selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer,
  loadImage, renderMessageImages, renderMessageFiles, fileMentions, useSession, renderSlot, t,
}: Omit<ChatNodeSeatProps, 'nodeKey' | 'roundByTurn'> & {
  readonly flowKey: string
  readonly nodeKey?: string
  readonly submission?: PendingSubmission
  readonly round: number
  readonly onWithdraw?: () => void
}) {
  const node = useSession(snapshot => (
    nodeKey === undefined ? undefined : snapshot.chat.nodes.get(nodeKey)
  ))
  const routed = node?.kind === 'user' || node?.kind === 'steering' ? node : undefined
  const visible = routed === undefined || userMessageHasReaderSurface(routed.data.content)
  const owner = useMemo<ChatNodeOwnerProps | null>(() => routed === undefined
    ? null
    : {
      selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer,
      loadImage, renderMessageImages, renderMessageFiles, fileMentions,
    }, [
    routed, selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer,
    loadImage, renderMessageImages, renderMessageFiles, fileMentions,
  ])
  if (!visible) return null
  const routedOwner = routed === undefined || owner === null
    ? null
    : { ...owner, node: routed } as RoutedChatNodeOwner
  // Anchor follows the durable node once it exists (rail jumps). The React
  // key stays on `flowKey` (`rpc:…`) so this div is not remounted on handoff.
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routed?.key ?? flowKey}
      data-chat-flow-key={routed?.key ?? flowKey}
      data-chat-flow-kind={routed?.kind ?? 'user'}
      data-chat-round={round}
      data-send-flow={flowKey}
    >
      <div className={css.roundLabel}>{t('chat.turnNavigation.turn', { turn: round })}</div>
      {routedOwner !== null && routed !== undefined ? renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routed.kind,
        hookContext: nodeKey ?? flowKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routed.kind })}
            payload={routed.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      }) : submission !== undefined ? (
        <PendingSubmissionBubble
          submission={submission}
          reserveActions
          {...(onWithdraw === undefined ? {} : { onWithdraw })}
          renderMessageImages={renderMessageImages}
          renderMessageFiles={renderMessageFiles}
          t={t}
        />
      ) : null}
    </div>
  )
})
