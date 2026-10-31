/** One foldable process run: a summary header, then the member rows.
 *
 * The fold itself lives in {@link useFoldDriver} — measure before the commit,
 * give the height back after it. This file is the chrome and nothing else, the
 * same split DSH makes between `InputFoldDriver` and its group seat.
 *
 * DSH also splits a per-member action surface (`ChatGroupSeat`); an XRK group
 * only folds, so one header over the rows is the whole surface.
 *
 * Members stay mounted while folded. The body uses `hidden="until-found"`
 * (DSH searchable-hidden) so layout drops in one frame — grid-row collapse
 * painted mid-heights that lifted the sticky composer. Header chrome stays
 * outside the hidden body; paging probes skip `[hidden]` subtrees like DSH.
 */

import { memo } from 'react'
import type { ComponentProps } from 'react'
import { DisclosureRow, IconChecklistOutlineRegular } from '@xrkseek/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { FlowEntry, ProcessGroupSummary } from '../conversation-nodes/process-groups.ts'
import {
  classifyProcessTool,
  countProcessActivity,
  formatProcessActivity,
} from '../conversation-nodes/process-activity.ts'
import {
  processGroupSettled,
  type ProcessFoldWhen,
} from '../conversation-nodes/presentation-policy.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { useFoldDriver } from './use-fold-driver.ts'
import css from './ChatView.module.css'

type GroupEntry = Extract<FlowEntry, { kind: 'group' }>

/** How many distinct tool names the open-run detail keeps before `+N`. */
const TOOL_NAME_CAP = 3

/**
 * Map XRK tool buckets onto DSH `data-process-activity` vocabulary so
 * community CSS / icons that key on ChatGroupSeat kinds still resolve.
 */
function dshProcessActivity(
  live: boolean,
  summary: ProcessGroupSummary,
): string {
  if (live) {
    if (summary.runningTool !== undefined) {
      return mapBucketToDsh(classifyProcessTool(summary.runningTool))
    }
    return 'thinking'
  }
  const first = summary.toolCallNames[0]
  if (first !== undefined) return mapBucketToDsh(classifyProcessTool(first))
  if (summary.reasoning > 0) return 'thinking'
  return 'thinking'
}

function mapBucketToDsh(
  bucket: ReturnType<typeof classifyProcessTool>,
): string {
  switch (bucket) {
    case 'files': return 'read'
    case 'searches': return 'search'
    case 'commands': return 'commands'
    case 'edits': return 'edit'
    case 'web': return 'search'
    default: return 'code'
  }
}

type GroupProps = {
  readonly entry: GroupEntry
  readonly nodeSeat: Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey'>
  readonly t: ChatViewSlotProps['t']
  /**
   * When this run auto-folds (work-details mode).
   *
   * `never` keeps the run flat. Tool-row default expand is a separate
   * preference and does not veto folding.
   */
  readonly foldWhen: ProcessFoldWhen
  /**
   * Session is idle and this run has no in-flight tools. Used when Host has
   * cleared `running` but the Turn Location has not closed yet (lost turn/end).
   */
  readonly idleSettled?: boolean | undefined
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

/**
 * Open-run detail beside「过程」(live tool name, or taxonomy when settled but
 * still expanded). Folded chrome uses {@link foldedTitle} instead — Cursor
 * style is a single activity line, not "Process · N steps".
 */
function openDetail(
  summary: ProcessGroupSummary,
  detail: boolean,
  liveDetail: boolean,
  t: ChatViewSlotProps['t'],
): string {
  // Live naming follows in-flight tools, not the fold latch.
  if (liveDetail && (summary.running || (summary.tools === 0 && summary.reasoning > 0))) {
    if (summary.runningTool !== undefined) return summary.runningTool
    if (summary.running) return t('row.running')
    if (summary.reasoning > 0 && summary.tools === 0) return t('think.title')
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

/** Folded header title: "Explored 6 files, 1 search". */
function foldedTitle(summary: ProcessGroupSummary, t: ChatViewSlotProps['t']): string {
  return formatProcessActivity(
    countProcessActivity(summary.toolCallNames, summary.reasoning),
    t as Parameters<typeof formatProcessActivity>[1],
    summary.tools + summary.reasoning,
  )
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
  entry, nodeSeat, t, foldWhen, idleSettled = false,
  detailTitles, liveProcessDetail, writeScroll, onFoldSettled,
}: GroupProps) {
  // Timing comes from the work-details mode (immediate / process / turn / never).
  const settled = processGroupSettled(foldWhen, entry, idleSettled)
  const { rootRef, folded, toggle } = useFoldDriver({
    closed: settled,
    foldAllowed: foldWhen !== 'never',
    writeScroll,
    onSettled: onFoldSettled,
  })
  // Shimmer tracks tools still in flight — independent of fold latch (manual
  // fold or `foldWhen: immediate` can hide the body while a tool still runs).
  const live = entry.summary.running
    || (entry.summary.tools === 0 && entry.summary.reasoning > 0)
  // Folded + live: keep「过程」as the title and put the in-flight tool in the
  // summary seat (same shape as open) — a title of bare `bash` read as a
  // tool-row expand, not a process fold.
  // Folded + settled: activity line ("Explored N files…").
  // Open:「过程」+ live/settled detail beside it.
  const showLiveChrome = live && (folded || liveProcessDetail)
  const liveLabel = entry.summary.runningTool
    ?? (entry.summary.running ? t('row.running') : t('think.title'))
  const headerTitle = folded && !showLiveChrome
    ? foldedTitle(entry.summary, t)
    : t('chat.process.title')
  const openSummary = folded
    ? (showLiveChrome ? liveLabel : undefined)
    : openDetail(entry.summary, detailTitles, liveProcessDetail, t)
  const titleClassName = folded && !showLiveChrome
    ? css.processGroupFoldedTitle
    : undefined

  const processActivity = dshProcessActivity(live, entry.summary)

  return (
    <div
      ref={rootRef}
      className={css.flowItem}
      data-process-group={entry.key}
      data-process-turn={entry.turn}
      // DSH TurnProcessNodeView — community glass CSS targets this attr.
      data-turn-process={entry.turn}
      data-folded={folded || undefined}
      data-process-running={live || undefined}
      // DSH ChatGroupSeat header activity kind (community icon / CSS keys).
      data-process-activity={processActivity}
    >
      <DisclosureRow
        icon={<IconChecklistOutlineRegular />}
        title={headerTitle}
        open={!folded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        titleClassName={titleClassName}
        collapsedContent={openSummary === undefined ? undefined : (
          <>
            <span className={css.processGroupSep} aria-hidden />
            <span
              className={showLiveChrome ? css.processGroupSummaryLive : css.processGroupSummary}
              data-process-summary=""
            >
              {openSummary}
            </span>
          </>
        )}
      />
      <div
        className={css.processGroupBody}
        data-folded={folded || undefined}
        data-process-group-body=""
        // DSH searchable-hidden: sync on the ref callback so expand never
        // paints a frame still carrying until-found (React 18 has no string
        // `hidden` prop).
        ref={(el) => {
          if (el === null) return
          if (folded) el.setAttribute('hidden', 'until-found')
          else el.removeAttribute('hidden')
        }}
      >
        <div className={css.processGroupInner}>
          {entry.members.map(member => (
            <ChatNodeSeat key={member.key} nodeKey={member.key} {...nodeSeat} />
          ))}
        </div>
      </div>
    </div>
  )
}, (previous: GroupProps, next: GroupProps) => (
  previous.foldWhen === next.foldWhen
  && previous.idleSettled === next.idleSettled
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
  && previous.entry.summary.toolCallNames.length === next.entry.summary.toolCallNames.length
  && previous.entry.summary.toolCallNames.every((name, index) => name === next.entry.summary.toolCallNames[index])
))
