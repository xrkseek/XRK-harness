// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, and unknown-surface JSON rows.

import { Fragment, memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type {
  ModelRetryNode, PendingSubmission, PendingSubmissionAttachment, TurnErrorNode, UserMessageNode,
} from '@xrkseek/client-runtime/client'
import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import {
  fileExtension, FileTypeIcon, fileSizeText, JsonBlock, MessageText, StateDot,
} from '@xrkseek/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, MessageImageOwner } from '../contract/slots.ts'
import { ReferenceIcon, type ReferenceIconKind } from '../reference/ReferenceIcon.tsx'
import { scanTextRefs } from '../input/decorations.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import { getEditStaging, subscribeEditStaging } from './resubmit-intent.ts'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
export type PresentedAttachment =
  | { readonly type: 'image'; readonly image: MessageImageOwner }
  | { readonly type: 'file'; readonly file: FileAttachmentRef }

/**
 * Project one local submission echo's attachments into the bubble's rendered
 * sequence: images become blob previews, files keep their durable card.
 *
 * Shared so a Host steering row that has already outlived its echo can still
 * paint the previews instead of falling back to authorized durable reads.
 * @param attachments - the echo's attachments, in prompt order.
 * @returns the presented attachment sequence for {@link UserStyleBubble}.
 */
export function previewAttachmentsOf(
  attachments: readonly PendingSubmissionAttachment[],
): readonly PresentedAttachment[] {
  return attachments.map(attachment => attachment.type === 'image'
    ? {
      type: 'image',
      image: {
        preview: {
          url: attachment.value.previewUrl,
          ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
          ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
          ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
        },
      },
    }
    : { type: 'file', file: attachment.value })
}

function isFileAttachment(value: unknown): value is FileAttachmentRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return typeof o.attachmentId === 'string'
    && o.attachmentId.length > 0
    && typeof o.name === 'string'
    && o.name.length > 0
    && typeof o.bytes === 'number'
    && Number.isFinite(o.bytes)
    && o.bytes >= 0
    && (o.mediaType === undefined || typeof o.mediaType === 'string')
}

function contentParts(content: readonly unknown[]): {
  text: string
  segments: readonly string[]
  attachments: PresentedAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: PresentedAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; modelOnly?: boolean; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') {
      // Harness-injected handle text (image/file attachment ids) reaches the
      // model but is not what the reader typed — keep it out of the bubble.
      if (b.modelOnly === true) continue
      texts.push(b.text)
    }
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && isFileAttachment(b.attachment)) {
      attachments.push({ type: 'file', file: b.attachment })
    }
    else rest.push(block)
  }
  const segments = texts.filter(part => part.length > 0)
  return { text: texts.join('\n\n'), segments, attachments, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'started'
      ? t('message.retry.started')
      : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {Math.round(node.delayMs)}ms
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {node.failure.message}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{node.message}</span>
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 *
 * The chip grammar is the composer's own, so a bubble never paints a
 * reference the composer would not: an `@` token must carry path shape
 * (quoted path, nested path, or a leaf with an extension) — a bare `@word`
 * stays prose, which is what keeps `@someone` and `@anthropic` out. Slash
 * tokens reuse the composer trigger shape with the lexicon dropped (a sent
 * log has none), and the trailing boundary is what keeps prose paths out:
 * `/command args` paints, `/api/dashboard`, `/plan.md`, and `// note` do not.
 */

const SLASH_CHIP_RE = /(^|\s)(\/[\w-]+)(?=\s|$)/gu

/** Sentence punctuation a shape match may have swallowed (`@README.md,`). */
const TRAILING_PUNCT_RE = /[.,;:!?，。；：！？]+$/u

function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  const ranges: { start: number; end: number; label: string; appearance?: ReferenceIconKind }[] = []
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, appearance: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  for (const range of scanTextRefs(text)) {
    const label = text.slice(range.start, range.end).replace(TRAILING_PUNCT_RE, '')
    if (label.length <= 1) continue
    ranges.push({ start: range.start, end: range.start + label.length, label, appearance: range.appearance })
  }
  SLASH_CHIP_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SLASH_CHIP_RE.exec(text)) !== null) {
    const label = m[2] ?? ''
    ranges.push({ start: m.index + (m[1]?.length ?? 0), end: m.index + m[0].length, label })
  }
  ranges.sort((a, b) => a.start - b.start
    || (a.appearance === b.appearance ? b.end - a.end : a.appearance === 'session' ? -1 : 1))
  const parts: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, appearance } = range
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    const displayLabel = appearance === undefined
      ? label
      : appearance === 'session'
        ? label.slice(1)
        : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1)
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={appearance ?? 'skill'}
        title={label}
      >
        {appearance !== undefined && (
          <ReferenceIcon kind={appearance} size={16} className={css.refIcon} />
        )}
        <span className={css.refLabel}>{displayLabel}</span>
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, renderMessageFiles, actions, steer = false, echo = false,
  referenceLabels = [], previewAttachments, editing = false, t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Slot-backed file cards; falls back to an inline twin when the slot is empty. */
  renderMessageFiles?: ChatNodeOwnerProps['renderMessageFiles']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Mid-turn steer only. The next-turn send is ordinary idle chrome. */
  steer?: boolean
  /** Whether this is a local submission echo (invisible marker; paints like its durable replacement). */
  echo?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly PresentedAttachment[]
  /** Composer is staging an edit of this message. */
  editing?: boolean
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, segments, attachments: contentAttachments, rest } = contentParts(content)
  const attachments = previewAttachments ?? contentAttachments
  const compactImages = attachments.length > 1
  const truncated = (total: number): string => t('json.truncated', { total })
  const bodies = segments.length > 0 ? segments : (text !== '' || rest.length > 0 ? [text] : [])
  const showBubble = bodies.length > 0 || rest.length > 0
  return (
    <div
      className={css.userRow}
      data-pending-steering={steer || undefined}
      data-submission-echo={echo || undefined}
      data-editing={editing || undefined}
      aria-current={editing ? 'true' : undefined}
      aria-describedby={editing ? 'xrk-edit-staging-hint' : undefined}
      data-time-hover-root
    >
      <div className={css.userStack}>
        {steer ? (
          <span className={css.pendingSteerBadge} role="status">
            {t('message.pendingSteer')}
          </span>
        ) : null}
        {attachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {attachments.map((attachment, index) => attachment.type === 'image'
              ? (
                <Fragment key={`image:${index}`}>
                  {renderMessageImages({
                    images: [attachment.image],
                    align: 'end',
                    compact: compactImages,
                  })}
                </Fragment>
              )
              : (
                <Fragment key={`file:${index}`}>
                  {renderMessageFiles?.({
                    files: [{ attachment: attachment.file }],
                    align: 'end',
                  }) ?? (
                    <span className={css.fileCard} title={attachment.file.name}>
                      <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                      <span className={css.fileContent}>
                        <span className={css.fileName}>{attachment.file.name}</span>
                        <span className={css.fileMeta}>
                          {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                            .filter(Boolean).join(' ')}
                        </span>
                      </span>
                    </span>
                  )}
                </Fragment>
              ))}
          </div>
        )}
        {showBubble && bodies.map((body, index) => (
          <div key={index} className={css.bubble}>
            {projectUserText(body, index === 0 ? referenceLabels : [])}
            {index === bodies.length - 1
              ? rest.map((block, i) => (
                <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />
              ))
              : null}
          </div>
        ))}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 *
 * `previewAttachments` carries the local echo's blob previews when that echo is
 * still alive: a Host row only starts painting after its echo retired or never
 * had one, and durable refs are unauthorized reads until the message is logged.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, previewAttachments, renderMessageImages, renderMessageFiles, steer = false, onWithdraw, t }: {
  content: readonly unknown[]
  /** Local echo previews replacing the content-derived attachment sequence. */
  previewAttachments?: readonly PresentedAttachment[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  renderMessageFiles?: ChatNodeOwnerProps['renderMessageFiles']
  steer?: boolean
  onWithdraw?: (() => void) | undefined
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      {...(previewAttachments === undefined ? {} : { previewAttachments })}
      renderMessageImages={renderMessageImages}
      {...(renderMessageFiles === undefined ? {} : { renderMessageFiles })}
      steer={steer}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
          onWithdraw={onWithdraw}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language as the Host occurrence that replaces it: draft text plus
 * object-URL previews, visible from the submit click until the durable
 * `user/message` or steering occurrence renders.
 * @param props - the session snapshot's pending submission and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, renderMessageImages, renderMessageFiles, steer = false, onWithdraw, t }: {
  submission: PendingSubmission
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  renderMessageFiles?: ChatNodeOwnerProps['renderMessageFiles']
  steer?: boolean
  onWithdraw?: (() => void) | undefined
  t: ChatViewSlotProps['t']
}): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly PresentedAttachment[]>(
    () => previewAttachmentsOf(submission.attachments),
    [submission.attachments],
  )
  return (
    <UserStyleBubble
      content={content}
      previewAttachments={previewAttachments}
      renderMessageImages={renderMessageImages}
      {...(renderMessageFiles === undefined ? {} : { renderMessageFiles })}
      steer={steer}
      echo
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={submission.time}
          clock="start"
          className={css.actions}
          t={t}
          onWithdraw={onWithdraw}
        />
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, editAt, deleteAt, withdrawSteer, renderMessageImages, renderMessageFiles, useSession, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  const pendingAdmitId = useSession((s) => {
    const rpcId = data.source !== null && typeof data.source === 'object' && 'rpcId' in data.source
      ? data.source.rpcId
      : undefined
    const messageId = 'messageId' in data ? data.messageId : undefined
    return s.queue.find(row => row.placement === 'steering' && (
      (typeof rpcId === 'string' && row.rpcId === rpcId)
      || (typeof messageId === 'string' && (row.messageId === messageId || row.id === messageId))
    ))?.id
  })
  const text = useMemo(() => {
    const parts: string[] = []
    for (const block of data.content) {
      if (block !== null && typeof block === 'object' && 'type' in block && block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        // Model-only handle text never enters copy/edit — same rule as the bubble.
        if ((block as { modelOnly?: unknown }).modelOnly === true) continue
        parts.push((block as { text: string }).text)
      }
    }
    return parts.join('')
  }, [data.content])
  const canEdit = text.trim() !== ''
  const editStaging = useSyncExternalStore(subscribeEditStaging, getEditStaging, getEditStaging)
  const editing = editStaging !== null && editStaging.seq === data.seq
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      renderMessageFiles={renderMessageFiles}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      steer={pendingAdmitId !== undefined}
      editing={editing}
      t={t}
      actions={copyText => (
        <MessageIconActions
          text={copyText}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
          onEdit={pendingAdmitId !== undefined || !canEdit || editing ? undefined : () => { editAt(data.seq, text) }}
          onDelete={pendingAdmitId !== undefined || editing ? undefined : () => { deleteAt(data.seq) }}
          onWithdraw={pendingAdmitId === undefined ? undefined : () => { withdrawSteer(pendingAdmitId) }}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  // Match buildViewNode: cancelled attempts are omitted or order-hidden; never
  // paint a "retry cancelled" tombstone next to turn-end abort chrome.
  if (data.current.retryState === 'cancelled') return null
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
