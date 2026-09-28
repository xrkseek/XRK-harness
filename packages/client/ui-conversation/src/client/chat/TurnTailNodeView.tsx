import { memo } from 'react'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/**
 * Turn-local feature tail + message actions.
 * Completed-turn footers stay mounted across later turns — hiding them while
 * `session.running` made every prior turn lose copy / feedback / usage as soon
 * as the next round started. Branch/restore still use `hasLaterChatNode` /
 * `branchUnavailable` so mid-history forks stay gated.
 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, restoreAt, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
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
  // Interruption-frozen partials carry no messageId — copy / branch / usage
  // still render; feedback (needs a durable id) stays off.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  const actionsUnavailable = data.branchUnavailable || hasLaterChatNode
  return (
    <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        onRestore={() => { restoreAt(closing.finalNode.seq) }}
        branchUnavailable={actionsUnavailable}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={data.tokenUsage === undefined && runMs === undefined
          ? undefined
          : (
            <>
              {data.tokenUsage !== undefined && <TurnUsagePanel usage={data.tokenUsage} t={t} />}
              {runMs !== undefined && (
                <TurnTimePanel
                  runMs={runMs}
                  tokensPerSecond={data.tokensPerSecond}
                  ttftMs={data.ttftMs}
                  t={t}
                />
              )}
            </>
          )}
        t={t}
      />
    </div>
  )
})
