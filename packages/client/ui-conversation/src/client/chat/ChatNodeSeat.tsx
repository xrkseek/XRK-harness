import { memo, useMemo } from 'react'
import { JsonBlock } from '@xrkseek/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { usePostStreamLive } from './use-post-stream-live.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, deleteAt, withdrawSteer, loadImage,
  renderMessageImages, renderMessageFiles, fileMentions, useSession, renderSlot, t,
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
      deleteAt,
      withdrawSteer,
      loadImage,
      renderMessageImages,
      renderMessageFiles,
      fileMentions,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, restoreAt, editAt, deleteAt, withdrawSteer, loadImage,
    renderMessageImages, renderMessageFiles, fileMentions,
  ])
  const streamingAssistant = routedNode?.kind === 'assistant-step'
    && (routedNode.data as { readonly status?: string }).status === 'running'
  // Grace after settle: flipping off `data-live` the same frame as streaming
  // ends lets content-visibility:auto blank an expanded Think row briefly.
  const postStreamLive = usePostStreamLive(streamingAssistant === true)
  if (routedNode === undefined || owner === null) return null
  const location = routedNode.location
  const turn = routedNode.kind === 'steering'
    ? undefined
    : location.kind === 'turn' || location.kind === 'step'
      ? location.turn.turn
      : undefined
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  // Running assistants need live layout for scroll-follow. Turn-tails also: Stop
  // materializes a tall ChangedFiles card in one paint, and content-visibility
  // auto/skip has left a second ghost copy of that card in Chromium.
  const live = postStreamLive || routedNode.kind === 'turn-tail'
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-live={live || undefined}
    >
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
