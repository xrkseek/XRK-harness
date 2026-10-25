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

/** Summary line for a group header; quiet modes count steps instead of naming them. */
function groupTitle(summary: ProcessGroupSummary, detail: boolean, t: ChatViewSlotProps['t']): string {
  if (!detail) return t('chat.process.steps', { count: summary.tools + summary.reasoning })
  const parts: string[] = []
  if (summary.tools > 0) parts.push(t('chat.process.tools', { count: summary.tools }))
  if (summary.reasoning > 0) parts.push(t('chat.process.reasoning', { count: summary.reasoning }))
  return parts.join(' · ')
}

/** Rows hidden behind one header inside a Turn's process run. */
export const ProcessGroupSeat = memo(function ProcessGroupSeat({
  entry, nodeSeat, t, deferFold, foldCompletedTurns, detailTitles, writeScroll, onFoldSettled,
}: GroupProps) {
  const { rootRef, folded, toggle } = useFoldDriver({
    closed: entry.closed,
    foldAllowed: foldCompletedTurns,
    deferFold,
    writeScroll,
    onSettled: onFoldSettled,
  })

  return (
    <div
      ref={rootRef}
      className={css.flowItem}
      data-process-group={entry.key}
      data-process-turn={entry.turn}
      data-folded={folded || undefined}
    >
      <DisclosureRow
        icon={<IconChecklistOutlineRegular />}
        title={t('chat.process.title')}
        open={!folded}
        expandable
        onToggle={toggle}
        collapsedContent={
          <span className={css.processGroupSummary}>{groupTitle(entry.summary, detailTitles, t)}</span>
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
))
