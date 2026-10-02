/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@xrkseek/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

/** Survive assistant-step remounts so an open Think body does not collapse. */
const expandedByKey = new Map<string, boolean>()

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.persistKey - optional turn/step key to keep expand across remounts.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({
  text, running, persistKey, t,
}: {
  text: string
  running: boolean
  persistKey?: string | undefined
  t: ChatViewSlotProps['t']
}) {
  // Collapsed by default (Codex/DSH posture): the one-line summary follows the
  // latest streamed line; expand only when the reader opens the full body.
  const [expanded, setExpanded] = useState(() => (
    persistKey !== undefined ? (expandedByKey.get(persistKey) ?? false) : false
  ))
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  const toggle = (): void => {
    setExpanded((value) => {
      const next = !value
      if (persistKey !== undefined) expandedByKey.set(persistKey, next)
      return next
    })
  }

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('think.title')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={toggle}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
