import { memo } from 'react'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/**
 * Turn-local feature tail + message actions.
 * Copy / feedback / branch only after the session is idle — while the agent
 * is still running, completed-turn footers must not sit above live tool rows
 * (stricter than DSH, matches product: actions appear when the run finishes).
 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  const sessionRunning = useSession(snapshot => snapshot.running === true)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) return tail === null ? null : <div className={css.root}>{tail}</div>
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const showMessageActions = !sessionRunning
  const assistantActions = !showMessageActions || messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  return (
    <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
      {tail}
      {showMessageActions ? (
        <MessageIconActions
          text={assistantText(closing.blocks)}
          time={closing.time}
          runMs={runMs}
          ttftMs={data.ttftMs}
          tokensPerSecond={data.tokensPerSecond}
          clock="end"
          onBranch={() => { forkAt(closing.finalNode.seq) }}
          branchUnavailable={data.branchUnavailable || hasLaterChatNode}
          className={css.actions}
          extraActions={assistantActions}
          t={t}
        />
      ) : null}
    </div>
  )
})
