import { memo } from 'react'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { turnEndedAsStop } from '../conversation-nodes/common.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

function turnEndRunMs(turn: {
  readonly start?: { readonly time: number } | undefined
  readonly end?: { readonly time: number } | undefined
}, closingTime?: number): number | undefined {
  if (turn.start === undefined) return undefined
  if (turn.end !== undefined) {
    const fromEnds = Math.max(0, turn.end.time - turn.start.time)
    if (fromEnds > 0) return fromEnds
  }
  if (closingTime === undefined) return undefined
  return Math.max(0, closingTime - turn.start.time)
}

/**
 * Turn-local feature tail + message actions.
 * Completed-turn footers stay mounted across later turns — hiding them while
 * `session.running` made every prior turn lose copy / feedback / usage as soon
 * as the next round started. Branch/restore still use `hasLaterChatNode` /
 * `branchUnavailable` so mid-history forks stay gated.
 *
 * Stop / abnormal cut with no text reply still owes an end-of-turn row
 * (「已停止」 + 用时): `closing` may be null after Think+tool-only cancels.
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
  const runMs = turnEndRunMs(turn, closing?.time ?? data.time)
  const stopped = turnEndedAsStop(turn.end)
  const assistantAlreadyStopped = turn.steps.some((step) => {
    const assistant = step.data.get('assistant-step') as
      | { readonly status?: string; readonly finalNode?: { readonly interrupted?: boolean } }
      | undefined
    return assistant?.status === 'interrupted' || assistant?.finalNode?.interrupted === true
  })
  const showStopped = stopped && !assistantAlreadyStopped
  if (closing === null) {
    if (tail === null && runMs === undefined && !showStopped && data.tokenUsage === undefined) {
      return null
    }
    return (
      <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
        {tail}
        {showStopped ? <span className={css.stopped} role="status">{t('message.stopped')}</span> : null}
        {(data.tokenUsage !== undefined || runMs !== undefined) && (
          <MessageIconActions
            text=""
            time={data.time}
            clock="end"
            className={css.actions}
            usageAction={(
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
        )}
      </div>
    )
  }
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
      {showStopped ? <span className={css.stopped} role="status">{t('message.stopped')}</span> : null}
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
