/** One foldable process run: a summary header, then the member rows.
 *
 * The fold itself lives in {@link useFoldDriver} — measure before the commit,
 * give the height back after it. This file is the chrome and nothing else, the
 * same split DSH makes between `InputFoldDriver` and its group seat.
 *
 * DSH also splits a per-member action surface (`ChatGroupSeat`); an XRK group
 * only folds, so one header over the rows is the whole surface.
 *
 * Members stay mounted while folded. `display: none` rows would drop out of the
 * `data-chat-anchor-key` order the scroll restore and the reading probe read,
 * so a folded group would look like it deleted rows instead of hiding them —
 * which is why the header comes from `DisclosureRow` (chrome only) and the body
 * is rendered here instead of as that component's conditional children.
 */

import { memo } from 'react'
import type { ComponentProps } from 'react'
import { DisclosureRow, IconChecklistOutlineRegular } from '@xrkseek/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { FlowEntry, ProcessGroupSummary } from '../conversation-nodes/process-groups.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { useFoldDriver } from './use-fold-driver.ts'
import css from './ChatView.module.css'

type GroupEntry = Extract<FlowEntry, { kind: 'group' }>

/** How many distinct tool names the collapsed header keeps before `+N`. */
const TOOL_NAME_CAP = 3

type GroupProps = {
  readonly entry: GroupEntry
  readonly nodeSeat: Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey'>
  readonly t: ChatViewSlotProps['t']
  /** Whether the reader was pinned to the floor when the Turn closed. */
  readonly deferFold: boolean
  /**
   * Whether a completed Turn may fold this run at all.
   *
   * The work-details mode decides (`verbose` never folds), and the live
   * "auto-expand tools" switch overrides it: a reader who asked for every tool
   * row to start open did not ask for the run around them to be hidden.
   */
  readonly foldCompletedTurns: boolean
  /** Whether the header names what ran, or only counts steps. */
  readonly detailTitles: boolean
  /**
   * Whether an open run's header shows the live tool name (and shimmer).
   * Settled runs ignore this and use {@link detailTitles} instead.
   */
  readonly liveProcessDetail: boolean
  /**
   * Writes `scrollTop` through the owner of the observed-top ledger.
   *
   * A raw write from the fold driver would look like reader input to ChatView's
   * scroll handler — it compares the delivered offset against its own ledger —
   * and quietly drop follow ownership. The owner logs the write instead.
   */
  readonly writeScroll?: ((scrollport: HTMLElement, top: number) => void) | undefined
  /**
   * Called after a fold or unfold has landed in the DOM.
   *
   * The rows below the run move whether or not the offset was compensated, so
   * the reading anchor ChatView persists for the next repage would otherwise
   * name a row that no longer sits where it was sampled.
   */
  readonly onFoldSettled?: (() => void) | undefined
}

/** Collapsed / live summary line for a group header. */
function groupTitle(
  summary: ProcessGroupSummary,
  closed: boolean,
  detail: boolean,
  liveDetail: boolean,
  t: ChatViewSlotProps['t'],
): string {
  // Open run + live detail (DSH `liveProcessDetail`): name the in-flight work.
  if (!closed && liveDetail) {
    if (summary.runningTool !== undefined) return summary.runningTool
    if (summary.running) return t('row.running')
    if (summary.reasoning > 0 && summary.tools === 0) return t('think.title')
    const names = formatToolNames(summary.toolNames)
    if (names !== undefined) return names
    return t('row.running')
  }
  if (!detail) return t('chat.process.steps', { count: summary.tools + summary.reasoning })
  const parts: string[] = []
  const names = formatToolNames(summary.toolNames)
  if (names !== undefined) parts.push(names)
  else if (summary.tools > 0) parts.push(t('chat.process.tools', { count: summary.tools }))
  if (summary.reasoning > 0) parts.push(t('chat.process.reasoning', { count: summary.reasoning }))
  if (parts.length === 0) return t('chat.process.steps', { count: 0 })
  return parts.join(' · ')
}

/** First few unique tool names, with a `+N` tail when the list is longer. */
function formatToolNames(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined
  if (names.length <= TOOL_NAME_CAP) return names.join(' · ')
  const head = names.slice(0, TOOL_NAME_CAP).join(' · ')
  return `${head} +${names.length - TOOL_NAME_CAP}`
}

/** Rows hidden behind one header inside a Turn's process run. */
export const ProcessGroupSeat = memo(function ProcessGroupSeat({
  entry, nodeSeat, t, deferFold, foldCompletedTurns, detailTitles, liveProcessDetail,
  writeScroll, onFoldSettled,
}: GroupProps) {
  const { rootRef, folded, toggle } = useFoldDriver({
    closed: entry.closed,
    foldAllowed: foldCompletedTurns,
    deferFold,
    writeScroll,
    onSettled: onFoldSettled,
  })
  // DSH shimmers the whole process label while the Turn is still open — not
  // only while a tool root is in flight — so a folded header still reads live.
  const live = !entry.closed
  const title = groupTitle(entry.summary, entry.closed, detailTitles, liveProcessDetail, t)

  return (
    <div
      ref={rootRef}
      className={css.flowItem}
      data-process-group={entry.key}
      data-process-turn={entry.turn}
      data-folded={folded || undefined}
      data-process-running={live || undefined}
    >
      <DisclosureRow
        icon={<IconChecklistOutlineRegular />}
        title={t('chat.process.title')}
        open={!folded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={
          <>
            <span className={css.processGroupSep} aria-hidden />
            <span
              className={live ? css.processGroupSummaryLive : css.processGroupSummary}
              data-process-summary=""
            >
              {title}
            </span>
          </>
        }
      />
      <div className={css.processGroupBody} data-folded={folded || undefined} data-process-group-body="">
        <div className={css.processGroupInner}>
          {entry.members.map(member => (
            <ChatNodeSeat key={member.key} nodeKey={member.key} {...nodeSeat} />
          ))}
        </div>
      </div>
    </div>
  )
}, (previous: GroupProps, next: GroupProps) => (
  previous.deferFold === next.deferFold
  && previous.foldCompletedTurns === next.foldCompletedTurns
  && previous.detailTitles === next.detailTitles
  && previous.liveProcessDetail === next.liveProcessDetail
  && previous.t === next.t
  && previous.nodeSeat === next.nodeSeat
  && previous.writeScroll === next.writeScroll
  && previous.onFoldSettled === next.onFoldSettled
  && previous.entry.key === next.entry.key
  && previous.entry.closed === next.entry.closed
  // `flowEntries` re-derives the entry object every render, so identity never
  // matches. Comparing what the seat actually renders keeps a settled transcript
  // from re-rendering every member row on each keystroke elsewhere.
  && previous.entry.members.length === next.entry.members.length
  && previous.entry.members.every((member, index) => member.key === next.entry.members[index]?.key)
  && previous.entry.summary.tools === next.entry.summary.tools
  && previous.entry.summary.reasoning === next.entry.summary.reasoning
  && previous.entry.summary.running === next.entry.summary.running
  && previous.entry.summary.runningTool === next.entry.summary.runningTool
  && previous.entry.summary.toolNames.length === next.entry.summary.toolNames.length
  && previous.entry.summary.toolNames.every((name, index) => name === next.entry.summary.toolNames[index])
))
