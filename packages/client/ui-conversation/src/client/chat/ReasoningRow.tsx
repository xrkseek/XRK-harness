/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutlineRegular } from '@xrkseek/client-ui-primitives'
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
  let end = text.length
  while (end > 0) {
    const code = text.charCodeAt(end - 1)
    if (code !== 10 && code !== 13 && code !== 32 && code !== 9) break
    end -= 1
  }
  const newline = text.lastIndexOf('\n', Math.max(0, end - 1))
  return newline === -1 ? text.slice(0, end) : text.slice(newline + 1, end)
}

/** Live Think body cap. Full transcript stays in the log; the open row only
 *  lays out the tail so a long reasoning stream cannot pin the main thread. */
const LIVE_THINK_CHARS = 12_000

/** Whole-char blocks for the frozen/live split — see {@link splitThinkBody}. */
const FREEZE_CHUNK_CHARS = 1_024
/**
 * Newest characters kept mutable — one DOM text write per streaming frame, so
 * keep it small: the whole 12k node used to be rewritten for every token. The
 * floor alignment below can leave up to one chunk extra, i.e. 512–1535 chars.
 */
const LIVE_TAIL_CHARS = 512

/** Bounded memo: a long session must not pin one entry per assistant step. */
const EXPANDED_BY_KEY_MAX = 200

/**
 * Remember one row's disclosure state, newest last, oldest evicted.
 * Re-setting an existing key refreshes its position so the cap drops the least
 * recently touched step, not the oldest step id.
 */
function rememberExpanded(key: string, open: boolean): void {
  expandedByKey.delete(key)
  expandedByKey.set(key, open)
  while (expandedByKey.size > EXPANDED_BY_KEY_MAX) {
    const oldest = expandedByKey.keys().next()
    if (oldest.done === true) break
    expandedByKey.delete(oldest.value)
  }
}

/**
 * Split the visible reasoning window into an immutable prefix and a small live
 * tail. Both cuts are quantized to whole chunks of the ABSOLUTE text length, so
 * while tokens arrive the prefix string only changes every
 * {@link FREEZE_CHUNK_CHARS} characters: React then leaves that text node alone
 * and rewrites just the tail instead of re-laying out the whole block.
 * Concatenating the two halves always reproduces the same visible window the
 * single-node version rendered.
 * @param text - complete or streaming reasoning text.
 * @param running - whether this block is the streaming tail.
 * @returns the frozen prefix and the mutable tail (their concatenation is the
 * visible window).
 */
function splitThinkBody(text: string, running: boolean): { frozen: string; live: string } {
  if (!running) return { frozen: text, live: '' }
  const align = (value: number): number => (
    Math.floor(Math.max(0, value) / FREEZE_CHUNK_CHARS) * FREEZE_CHUNK_CHARS
  )
  const windowStart = align(text.length - LIVE_THINK_CHARS)
  const boundary = Math.max(windowStart, align(text.length - LIVE_TAIL_CHARS))
  return { frozen: text.slice(windowStart, boundary), live: text.slice(boundary) }
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
  // Halves are recomputed per streamed frame, but both cuts are chunk-aligned,
  // so the frozen string keeps the same value between cuts and React skips
  // that text node — only the live tail is rewritten in the DOM.
  const body = useMemo(() => splitThinkBody(text, running), [text, running])
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
      if (persistKey !== undefined) rememberExpanded(persistKey, next)
      return next
    })
  }

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      // DSH TurnTriggerNodeView stamped `data-turn-trigger` — wallpaper /
      // thinking-glass CSS still selects it.
      data-turn-trigger=""
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutlineRegular size={14} />}
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
        {/* Two adjacent text nodes, no whitespace between: the frozen half keeps
            an identical string across frames, so only the live tail mutates. */}
        <div className={css.thinkBody}>{body.frozen}{body.live}</div>
      </DisclosureRow>
    </div>
  )
}
