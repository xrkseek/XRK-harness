import { memo, useLayoutEffect, useState, type ReactNode } from 'react'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { stopLabelKey, turnAbortCause, turnEndedAsStop } from '../conversation-nodes/common.ts'
import { latestTurnNumber } from './pending-input-chrome.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import { humanTurnOpenerForRegenerate } from './human-turn-opener.ts'
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
 * as the next round started. Restore/regenerate stay tip-gated via
 * `hasLaterChatNode` / `branchUnavailable`; branch is a turn-cut fork and stays
 * available on any closed turn (Host anchors on the first `turn/end` at/after seq).
 *
 * Job-completion / subagent wakes are a normal next 轮次: prior turn footers
 * stay mounted and always-visible (no hover gate). Regenerate only mounts when
 * *this* Host turn has a human opener — wake tips keep copy/usage/branch but
 * not a misleading refresh that would truncate an earlier human round.
 *
 * Assembler only materializes visible tails after turn/end. Host `running` on
 * a still-latest closed tip suppresses the footer once (wait_agent / subagent
 * drain: Overview says 回合进行中). After the footer has painted while idle,
 * keep it — otherwise the next send flips `running` before `turn/start` and
 * the tip looks like wait_agent for one frame (文件变动 / 赞 / 复制 flash off).
 * Stop with no text reply still owes 「已停止」+用时 once idle.
 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, restoreAt, regenerateAt, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  // Host busy latch is outside the event timeline — only the tip footer waits.
  const tipBusyWhileLatest = useSession(snapshot =>
    snapshot.running && latestTurnNumber(snapshot.chat.timeline) === data.turn)
  // Latch after an idle paint so the next-send running race cannot unmount us.
  const [keepFooter, setKeepFooter] = useState(false)
  // Regenerate re-runs this turn's human-owned opener only — never seat /
  // auto-continue / a walked-back opener from a prior round.
  const regenerateSource = useSession((snapshot) => {
    const keys = snapshot.chat.locations.getTurn(data.turn)
    const nodes = keys.flatMap((key) => {
      const candidate = snapshot.chat.nodes.get(key)
      return candidate === undefined ? [] : [candidate]
    })
    return humanTurnOpenerForRegenerate(nodes)
  })
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  useLayoutEffect(() => {
    if (turn?.status === 'closed' && !tipBusyWhileLatest) setKeepFooter(true)
  }, [turn?.status, tipBusyWhileLatest])
  const suppressTipWhileRunning = tipBusyWhileLatest && !keepFooter
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
  // Human opener Stop with no assistant text: say so. Bare 「已停止」 after a
  // visible user bubble reads like a broken turn.
  const stoppedText = !stopped
    ? undefined
    : (closing === null && regenerateSource !== null
      ? t('message.stopped.noReply')
      : t(stopLabelKey(turnAbortCause(turn.end))))
  const showStopped = stopped && !assistantAlreadyStopped && stoppedText !== undefined
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
    // Inject/catalog-only abort (no human speech, no assistant reply): a lone
    // 「已停止」+用时 confuses beginners on Overview seed sessions. Suppress
    // regardless of empty slot shells from renderSlotChain (display:contents).
    if (regenerateSource === null) {
      return null
    }
    if (tail === null && runMs === undefined && !showStopped && data.tokenUsage === undefined) {
      return null
    }
    return (
      <div
        className={css.root}
        data-turn-tail={data.turn}
        data-actions-reveal="always"
      >
        {tail}
        {showStopped ? <span className={css.stopped} role="status">{stoppedText}</span> : null}
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
  // Regenerate rewrites the transcript tail in place, so it needs this turn's
  // tip (no later same-turn node). Restore is files-only (`/rollback`) and is
  // tip-gated the same way so the button stays next to a settled assistant
  // close — not mid-turn after steering. Branch is a turn-cut fork: Host
  // anchors on the first `turn/end` at/after seq, so any closed turn works
  // even with later turns below. `branchUnavailable` stays off here — reaching
  // this render already proved `closing !== null`.
  const tipActionsUnavailable = data.branchUnavailable || hasLaterChatNode
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-actions-reveal="always"
    >
      {tail}
      {showStopped ? <span className={css.stopped} role="status">{stoppedText}</span> : null}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        onRestore={() => { restoreAt(closing.finalNode.seq) }}
        // Only mount regenerate when this turn has a human opener and is tip.
        onRegenerate={regenerateSource === null || tipActionsUnavailable
          ? undefined
          : () => { regenerateAt(regenerateSource.seq, regenerateSource.content) }}
        tipUnavailable={tipActionsUnavailable}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={usageAction}
        t={t}
      />
    </div>
  )
})
