// Session stats under the composer, split into two icon pills: a gauge pill
// (turn/step counts + output speed) opening the time-and-speed dialog, and a
// database pill (total tokens + cache hit) opening the token-usage dialog.
// Settled-node identity prevents stream-delta updates from rerendering the row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).
// Token totals ride `tokenUsage` (meter); cost estimates stay on Face `costUsage`
// for the cost meter — one home per fact.

import { memo, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconDatabaseOutline16, IconGaugeOutline16 } from '@xrkseek/client-ui-primitives'
import type { UseProjection } from '@xrkseek/client-runtime/client'
import type { SnapshotSelectorHook } from '@xrkseek/client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@xrkseek/xrk-session-stats/client'
import type { TokenUsageProjection } from '@xrkseek/xrk-token-meter/client'
import type { ConversationSnapshot } from '@xrkseek/client-runtime/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { formatExactTokens, formatTokens as formatTokensLocale } from './token-format.ts'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import {
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  formatDuration,
  type WindowStats,
} from './stats-metrics.ts'
import css from './StatsLine.module.css'
import dialogCss from './stat-dialog.module.css'

export {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  deriveStats,
  formatDuration,
  formatTokens,
} from './stats-metrics.ts'

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

function exactCount(value: number, t: ComposerBarProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/** External open state one pill's dialog reads and writes (the row's exclusive slot). */
type PillDialog = Pick<ReturnType<typeof useStatDialog>, 'open' | 'setOpen'>

function TimePill({ stats, t, dialog }: {
  stats: WindowStats
  t: ComposerBarProps['t']
  dialog: PillDialog
}) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
  const tps = stats.decodeMs > 0
    ? t('message.tokensPerSecond', {
      tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
    })
    : null
  const label = (
    <span className={css.label}>
      {counts}
      {tps !== null && (
        <>
          <span className={css.sep} aria-hidden>·</span>
          {tps}
        </>
      )}
    </span>
  )
  // A window without one timed figure has no dialog rows to show, so the pill
  // stays a plain reading instead of a button opening an empty dialog.
  if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && stats.decodeMs <= 0) {
    return (
      <span className={css.anchor}>
        <span className={css.pill}>
          <IconGaugeOutline16 />
          {label}
        </span>
      </span>
    )
  }
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tps === null ? counts : `${counts} · ${tps}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconGaugeOutline16 />
        {label}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconGaugeOutline16 />
              {t('stats.dialog.title')}
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-session-stats-details>
            {stats.llmMs > 0 && (
              <>
                <dt>{t('stats.dialog.llmTime')}</dt>
                <dd>{formatDuration(stats.llmMs, t)}</dd>
              </>
            )}
            {stats.toolMs > 0 && (
              <>
                <dt>{t('stats.dialog.toolTime')}</dt>
                <dd>{formatDuration(stats.toolMs, t)}</dd>
              </>
            )}
            {stats.ttftSteps > 0 && (
              <>
                <dt>{t('stats.dialog.ttft')}</dt>
                <dd>{formatDuration(stats.ttftMs / stats.ttftSteps, t)}</dd>
              </>
            )}
            {stats.decodeMs > 0 && (
              <>
                <dt>{t('stats.dialog.speed')}</dt>
                <dd>{t('message.tokensPerSecond', {
                  tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
                })}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

function UsagePill({ usage, t, dialog }: {
  usage: TokenUsageProjection
  t: ComposerBarProps['t']
  dialog: PillDialog
}) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const total = billedInputTokens(usage) + usage.outputTokens
  const totalText = t('message.turnUsage.count', { count: formatTokensLocale(total, t) })
  const cacheHit = cacheHitPercent(usage)
  const cacheHitText = cacheHit !== null ? t('stats.cacheHit', { percent: cacheHit }) : null
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={css.label}>
          {totalText}
          {cacheHitText !== null && (
            <>
              <span className={css.sep} aria-hidden>·</span>
              {cacheHitText}
            </>
          )}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.usageTitle')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutline16 />
              {t('stats.dialog.usageTitle')}
            </span>
            <span className={dialogCss.titleValue}>{exactCount(total, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-session-stats-usage>
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{exactCount(usage.uncachedInputTokens, t)}</dd>
            <dt>{t('message.turnUsage.cacheRead')}</dt>
            <dd>{exactCount(usage.cacheReadTokens, t)}</dd>
            {usage.cacheWriteTokens !== 0 && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{exactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>{exactCount(usage.outputTokens, t)}</dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

export const StatsLine = memo(function StatsLine({ useSession, useProjection, t }: StatsLineProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // One exclusive slot for both dialogs: opening either pill closes the other.
  const [openPill, setOpenPill] = useState<'time' | 'usage' | null>(null)
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  // Gated on actual token activity: a session whose steps all settled without
  // billing (e.g. every request failed) shows its counts without a usage pill.
  const hasTokens = usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
  if (stats.steps === 0 && !hasTokens) return null
  // data-composer-stats: InputBar's `.root:has([data-composer-stats])` rule
  // tightens the composer's bottom clearance only while this row renders.
  return (
    <div className={css.root} data-composer-stats>
      {stats.steps > 0 && (
        <TimePill
          stats={stats}
          t={t}
          dialog={{
            open: openPill === 'time',
            setOpen: (open) => { setOpenPill(open ? 'time' : null) },
          }}
        />
      )}
      {hasTokens && (
        <UsagePill
          usage={usage}
          t={t}
          dialog={{
            open: openPill === 'usage',
            setOpen: (open) => { setOpenPill(open ? 'usage' : null) },
          }}
        />
      )}
    </div>
  )
})
