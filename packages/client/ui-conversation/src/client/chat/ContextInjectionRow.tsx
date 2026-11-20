import { useState, type ReactNode } from 'react'
import type { ContextMessageNode } from '@xrkseek/client-runtime/client'
import { projectTranscriptChrome } from '@xrkseek/client-runtime/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import {
  IconBellOutlineRegular,
  IconBrowseOutlineRegular,
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDeliverDocRegular,
  IconSparkleRegular,
  useExpandScrollPreserve,
} from '@xrkseek/client-ui-primitives'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** First non-empty text block — fallback when a notice forgot `summary`. */
function contentFirstLine(content: ContextMessageNode['content']): string | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    const line = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
    if (line !== '') return line.length > 120 ? `${line.slice(0, 119)}…` : line
  }
  return null
}

/** Localize wire job status tokens inside a collapsed summary. */
function localizeJobStatusBits(
  text: string,
  t: ChatViewSlotProps['t'],
): string {
  return text
    .replace(/\bcompleted\b/gi, t('message.context.jobStatus.completed'))
    .replace(/\bkilled\b/gi, t('message.context.jobStatus.killed'))
    .replace(/\bfailed\b/gi, t('message.context.jobStatus.failed'))
    .replace(/\bstopping\b/gi, t('message.context.jobStatus.stopping'))
    .replace(/\brunning\b/gi, t('message.context.jobStatus.running'))
}

/**
 * Collapsed one-liner for notices. Prefer Host `summary` / `jobId`; never dump
 * the full English Face body (`background job … finished [status:…]`) into the chip.
 */
function collapsedNoticeSummary(
  content: ContextMessageNode['content'],
  source: unknown,
  isJobCompletion: boolean,
  t: ChatViewSlotProps['t'],
): string | null {
  const record = typeof source === 'object' && source !== null
    ? source as Record<string, unknown>
    : null
  const stamped = record !== null && typeof record.summary === 'string' && record.summary.trim() !== ''
    ? record.summary.trim()
    : null
  if (stamped !== null) {
    return isJobCompletion ? localizeJobStatusBits(stamped, t) : stamped
  }
  const jobId = record !== null && typeof record.jobId === 'string' && record.jobId.trim() !== ''
    ? record.jobId.trim()
    : null
  const line = contentFirstLine(content)
  if (isJobCompletion) {
    if (line !== null) {
      const withStatus = /^background job (\S+)(?:\s+\([^)]*\))?\s+finished\s+\[status:\s*([^\]\n]+)/i
        .exec(line)
      if (withStatus?.[1] !== undefined) {
        const status = (withStatus[2] ?? '').trim()
        const compact = status !== '' ? `${withStatus[1]} [${status}]` : withStatus[1]
        return localizeJobStatusBits(compact, t)
      }
      const bare = /^background job (\S+)/i.exec(line)
      if (bare?.[1] !== undefined) return bare[1]
    }
    if (jobId !== null) return jobId
  }
  if (line === null) return jobId
  // Quiet chip: keep the first clause, not a paragraph.
  const clause = line.split(/[。.!?]/, 1)[0]?.trim() ?? line
  return clause.length > 72 ? `${clause.slice(0, 71)}…` : clause
}

/**
 * Localize stable provenance labels; plugin ids that are product events get
 * dedicated copy so the row never reads like a tool-call wire name.
 */
function localizeSourceLabel(
  label: string | null,
  t: ChatViewSlotProps['t'],
): string | null {
  if (label === null) return null
  if (label === 'auto-continue') return t('message.context.autoContinue')
  if (label === 'peer-collab') return t('message.context.handoff.peerCollab')
  if (label === 'thread-stop') return t('message.context.handoff.threadStop')
  if (label === 'subagent') return t('message.context.handoff.subagent')
  if (label === 'job-completion' || label === 'tool-jobs') {
    return t('message.context.jobCompletion')
  }
  if (label === 'subagent-mirror') return t('message.context.subagentMirror')
  if (label === 'ask-user' || label === 'parent-ask') {
    return t('message.context.askUser')
  }
  if (label === 'goals') return t('message.context.goals')
  if (label === 'plan-mode') return t('message.context.planMode')
  if (label === 'boss-status') return t('message.context.bossStatus')
  return label
}

/** Leading glyph for the centered notice chip. */
function noticeIcon(
  provenance: ContextMessageNode['provenance'],
  lane: string,
): ReactNode {
  if (provenance.role === 'recall') {
    return <span data-context-recall-icon><ReferenceIcon kind="session" /></span>
  }
  const label = provenance.label
  if (label === 'job-completion' || label === 'tool-jobs') {
    return <IconCheckCircleOutlineRegular size={14} />
  }
  if (lane === 'handoff' || label === 'subagent' || label === 'subagent-mirror') {
    return <IconDeliverDocRegular size={14} />
  }
  if (label === 'boss-status' || label === 'ask-user' || label === 'parent-ask') {
    return <IconBellOutlineRegular size={14} />
  }
  if (label === 'goals' || label === 'plan-mode') {
    return <IconSparkleRegular size={14} />
  }
  return <IconBrowseOutlineRegular size={14} />
}

/**
 * Centered expandable notice chip — not a ToolRow disclosure.
 *
 * Job completion, plugin notices, catalogs, and other model-visible injects
 * share this quiet mid-column card so they never read as a tool call. Identity
 * speech (human / seat / handoff 干员回传) stays on UserStyleBubble.
 */
export function ContextInjectionRow({ content, source, provenance, form, t }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false)
  const { rootRef: cardRef, noteExpand } = useExpandScrollPreserve(open)
  const { rendered, summary, body } = contextBody(form, { content, source, t })
  const chrome = projectTranscriptChrome({ surface: 'context', source })
  const localizedSource = localizeSourceLabel(provenance.label, t)
  const isJobCompletion = provenance.label === 'job-completion' || provenance.label === 'tool-jobs'
  const titleKey = chrome.lane === 'handoff'
    ? 'message.contextHandoff'
    : provenance.role === 'recall'
      ? 'message.contextRecall'
      : isJobCompletion
        ? 'message.context.jobCompletion'
        : 'message.contextInjection'
  const title = t(titleKey)
  // Job-completion already owns the title — do not repeat the producer id.
  const showSource = localizedSource !== null
    && !isJobCompletion
    && localizedSource !== title
  const collapsedSummary = form === 'notice' || rendered === 'notice'
    ? collapsedNoticeSummary(content, source, isJobCompletion, t)
    : summary
  const expandable = true
  const headerOpen = open

  const toggleOpen = () => {
    if (!open) noteExpand()
    setOpen(value => !value)
  }

  return (
    <div
      className={css.noticeRow}
      data-voice={chrome.voice}
      data-lane={chrome.lane}
      data-context-form={rendered ?? undefined}
      data-context-plugin={provenance.label ?? undefined}
    >
      <div ref={cardRef} className={css.noticeCard} data-open={headerOpen || undefined}>
        <button
          type="button"
          className={css.noticeHeader}
          aria-expanded={headerOpen}
          onClick={toggleOpen}
        >
          <span className={css.noticeLeading} aria-hidden>
            <span className={css.noticeGlyph}>
              {noticeIcon(provenance, chrome.lane)}
            </span>
            <span
              className={css.noticeDisclosure}
              data-context-disclosure={headerOpen ? 'expanded' : 'collapsed'}
            >
              {headerOpen
                ? <IconChevronDownOutlineRegular size={14} />
                : <IconChevronRightOutlineRegular size={14} />}
            </span>
          </span>
          <span className={css.noticeTitle}>{title}</span>
          {showSource ? (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.source} data-context-source>{localizedSource}</span>
            </>
          ) : null}
          {collapsedSummary !== null ? (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.summary} data-context-summary>{collapsedSummary}</span>
            </>
          ) : null}
        </button>
        {headerOpen && expandable ? (
          <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
            {body}
          </div>
        ) : null}
      </div>
    </div>
  )
}
