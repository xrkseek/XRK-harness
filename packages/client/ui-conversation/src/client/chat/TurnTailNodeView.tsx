import { memo, type ReactNode } from 'react'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { turnEndedAsStop } from '../conversation-nodes/common.ts'
import { latestTurnNumber } from './pending-input-chrome.ts'
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

function userPromptText(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (
      block !== null
      && typeof block === 'object'
      && 'type' in block
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ) {
      const text = (block as { text: string }).text
      if ((block as { modelOnly?: unknown }).modelOnly === true) continue
      parts.push(text)
    }
  }
  return parts.join('')
}

/**
 * Turn-local feature tail + message actions.
 * Completed-turn footers stay mounted across later turns — hiding them while
 * `session.running` made every prior turn lose copy / feedback / usage as soon
 * as the next round started. Branch/restore/regenerate still use
 * `hasLaterChatNode` / `branchUnavailable` so mid-history forks stay gated.
 *
 * Assembler only materializes visible tails after turn/end. Host `running` on
 * the tip Turn still suppresses the footer: wait_agent / subagent drain can
 * leave a closed tip while Overview says 回合进行中. Prior closed turns keep
 * their footers. Stop with no text reply still owes 「已停止」+用时 once idle.
 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, restoreAt, regenerateAt, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  // Host busy latch is outside the event timeline — only the tip footer waits.
  const suppressTipWhileRunning = useSession(snapshot =>
    snapshot.running && latestTurnNumber(snapshot.chat.timeline) === data.turn)
  // Regenerate re-runs the turn opener only — skip `steering` 插话 (step inject).
  const regenerateSource = useSession((snapshot) => {
    const keys = snapshot.chat.locations.getTurn(data.turn)
    for (const key of keys) {
      const candidate = snapshot.chat.nodes.get(key)
      if (candidate === undefined || candidate.kind !== 'user') continue
      const text = userPromptText(candidate.data.content as readonly unknown[])
      if (text.trim() === '') continue
      return { seq: candidate.data.seq, text }
    }
    return null
  })
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined || turn.status !== 'closed' || suppressTipWhileRunning) return null
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
  let usageAction: ReactNode
  if (data.tokenUsage === undefined && runMs === undefined) {
    usageAction = undefined
  } else {
    usageAction = (
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
    )
  }
  if (closing === null) {
    if (tail === null && runMs === undefined && !showStopped && data.tokenUsage === undefined) {
      return null
    }
    return (
      <div className={css.root} data-turn-tail={data.turn} data-time-hover-root data-actions-reveal="always">
        {tail}
        {showStopped ? <span className={css.stopped} role="status">{t('message.stopped')}</span> : null}
        {usageAction !== undefined && (
          <MessageIconActions
            text=""
            time={data.time}
            clock="end"
            className={css.actions}
            usageAction={usageAction}
            t={t}
          />
        )}
      </div>
    )
  }
  // Interruption-frozen partials carry no messageId — copy / branch / usage
  // still render; feedback (needs a durable id) stays off. Same-turn nodes
  // after this row (steering / trailing tools) keep the footer but drop 赞 —
  // ending rating belongs on the tip of a settled turn.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined || hasLaterChatNode
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  const actionsUnavailable = data.branchUnavailable || hasLaterChatNode
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-time-hover-root
      data-actions-reveal={actionsUnavailable ? 'hover' : 'always'}
    >
      {tail}
      {showStopped ? <span className={css.stopped} role="status">{t('message.stopped')}</span> : null}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        onRestore={() => { restoreAt(closing.finalNode.seq) }}
        // Only mount regenerate when it can run — hide on non-tip / busy turns
        // rather than showing a disabled refresh (control already existed).
        onRegenerate={regenerateSource === null || actionsUnavailable
          ? undefined
          : () => { regenerateAt(regenerateSource.seq, regenerateSource.text) }}
        branchUnavailable={actionsUnavailable}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={usageAction}
        t={t}
      />
    </div>
  )
})
