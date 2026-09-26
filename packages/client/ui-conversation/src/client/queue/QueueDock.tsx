// Queue dock entry: renders the authoritative transient inbox snapshot and
// addresses per-row mutations through the session-scoped conversation face.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
import type { Context } from '@xrkseek/cordis'
import { useEffect, useId, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { SessionId } from '@xrkseek/client-runtime/client'
import type { FileAttachmentRef, ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import {
  FileTypeIcon, fileSizeText,
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconQueueOutline14, IconSendOutline14, IconTrashOutline16, Tooltip,
} from '@xrkseek/client-ui-primitives'
import type { QueueAction, QueueItemId, QueueRow } from '../contract/queue.ts'
import { NS } from '../locales.ts'
import css from './QueueDock.module.css'

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<'ok' | 'steer-queued'>
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve one durable queued image into a session-scoped browser URL. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}

/**
 * Durable references carried by one queued row. Wire projections may omit the
 * attachment face — those blocks are skipped rather than trusted.
 */
function queueAttachments(content: QueueRow['content']): Array<
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
> {
  const attachments: Array<
    | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
    | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
  > = []
  for (const block of content) {
    if (block.type === 'image') {
      const { attachment } = block as { attachment?: ImageAttachmentRef }
      if (attachment !== undefined) attachments.push({ type: 'image', attachment })
    }
    if (block.type === 'file') {
      const { attachment } = block as { attachment?: FileAttachmentRef }
      if (attachment !== undefined && typeof attachment.name === 'string') {
        attachments.push({ type: 'file', attachment })
      }
    }
  }
  return attachments
}

/** Compact file identity used beside queue thumbnails. */
function QueueFile({ attachment, label }: { attachment: FileAttachmentRef; label: string }) {
  return (
    <span className={css.file} aria-label={label} title={attachment.name}>
      <span className={css.fileIcon} aria-hidden><FileTypeIcon path={attachment.name} size={16} /></span>
      <span className={css.fileName}>{attachment.name}</span>
      <span className={css.fileSize}>{fileSizeText(attachment.bytes)}</span>
    </span>
  )
}

/** One durable queued image as a fixed-size thumbnail; load failure keeps the empty placeholder. */
function QueueThumb({ attachment, loadImage, label }: {
  attachment: ImageAttachmentRef
  loadImage: QueueDockInjected['loadImage']
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage(attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? <span className={css.thumb} aria-hidden />
    : <img className={css.thumb} src={url} alt={label} />
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing.
 */
export function QueueDock({ useSession, updateQueue, notify, loadImage, t }: QueueDockProps) {
  const inbox = useSession(s => s.queue)
  const queue = useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // Same-render handoff: once the Host queue row carries the prompt rpcId,
  // drop the local echo so durable + echo never paint as two rows.
  const pendingQueued = useMemo(() => {
    const admitted = new Set(
      queue.flatMap(row => (row.rpcId !== undefined ? [row.rpcId] : [])),
    )
    return pendingSubmissions.filter(submission => (
      submission.placement === 'queued' && !admitted.has(submission.requestId)
    ))
  }, [pendingSubmissions, queue])
  const running = useSession(s => s.running)
  // Continuable children share the Host session queue (edit / remove / steer);
  // one-shot stays a read-only projection of any residual inbox rows.
  const queueMutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const [editing, setEditing] = useState<{ id: QueueItemId; text: string } | null>(null)
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()

  useEffect(() => {
    if (queue.length === 0 && pendingQueued.length === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
  }, [collapsed, editing, pendingQueued.length, queue, queueMutable])

  if (queue.length === 0 && pendingQueued.length === 0) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  const rowCount = queue.length + pendingQueued.length
  const listVisible = rowCount === 1 || expanded

  const applyAction = async (
    itemId: QueueItemId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      const outcome = await updateQueue(itemId, action)
      if (outcome === 'steer-queued') notify('info', t('queue.steer.queued'))
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {rowCount > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.count}>{t('queue.count', { n: rowCount })}</span>
            {!listVisible && pendingQueued.length > 0 && (
              <span className={css.status} role="status">{t('queue.sending')}</span>
            )}
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && queue.map(row => (
            <li
              key={row.id}
              className={css.row}
              tabIndex={queueMutable && editing === null && busy === null ? 0 : undefined}
              onKeyDown={(event) => {
                if (editing !== null || busy !== null || !queueMutable || !running) return
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                if (event.target !== event.currentTarget) return
                event.preventDefault()
                void applyAction(row.id, { kind: 'steer' }, t('queue.steerFailed'))
              }}
            >
              {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
              {queue.length === 1 && pendingQueued.length === 0 && <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>}
              {editing?.id === row.id
                ? (
                  <input
                    autoFocus
                    className={css.editor}
                    aria-label={t('queue.edit')}
                    value={editing.text}
                    onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditing(null)
                        return
                      }
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void saveEdit()
                      }
                    }}
                  />
                )
                : (
                  <>
                    {(() => {
                      const attachments = queueAttachments(row.content)
                      return attachments.length > 0
                        ? (
                          <span className={css.attachments}>
                            {attachments.map((item, index) => item.type === 'image'
                              ? (
                                <QueueThumb
                                  key={`${item.attachment.attachmentId}:${index}`}
                                  attachment={item.attachment}
                                  loadImage={loadImage}
                                  label={item.attachment.name ?? t('queue.image')}
                                />
                              )
                              : (
                                <QueueFile
                                  key={`${item.attachment.attachmentId}:${index}`}
                                  attachment={item.attachment}
                                  label={t('queue.file', { name: item.attachment.name })}
                                />
                              ))}
                          </span>
                        )
                        : null
                    })()}
                    <span className={css.preview}>{row.preview}</span>
                  </>
                )}
              {queueMutable && <div className={css.actions}>
                {editing?.id === row.id
                  ? (
                    <>
                      <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.save')}
                          disabled={busy !== null || editing.text.trim() === ''}
                          onClick={() => { void saveEdit() }}
                        >
                          <IconCheckOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.cancelEdit')}
                          disabled={busy !== null}
                          onClick={() => { setEditing(null) }}
                        >
                          <IconCloseOutline16 size={14} />
                        </button>
                      </Tooltip>
                    </>
                  )
                  : (
                    <>
                      <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.edit')}
                          // Disabled buttons fire no hover events, so the
                          // unsupported hint stays a native title.
                          title={row.text === null ? t('queue.edit.unsupported') : undefined}
                          disabled={busy !== null || row.text === null}
                          onClick={() => {
                            if (row.text !== null) setEditing({ id: row.id, text: row.text })
                          }}
                        >
                          <IconEditOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.remove')}
                          disabled={busy !== null}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'remove' },
                              t('queue.removeFailed'),
                            )
                          }}
                        >
                          <IconTrashOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip
                        label={running ? t('queue.steer.hint') : t('queue.steer.unavailable')}
                        side="bottom"
                        delayMs={500}
                      >
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.steer')}
                          title={running ? undefined : t('queue.steer.unavailable')}
                          disabled={busy !== null || !running}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'steer' },
                              t('queue.steerFailed'),
                            )
                          }}
                        >
                          <IconSendOutline14 />
                        </button>
                      </Tooltip>
                    </>
                  )}
              </div>}
            </li>
          ))}
          {listVisible && pendingQueued.map((submission) => (
            <li key={submission.requestId} className={`${css.row} ${css.pendingRow}`} data-submission-echo="">
              {rowCount === 1 && <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>}
              {submission.attachments.length > 0 && (
                <span className={css.attachments}>
                  {submission.attachments.map((attachment, index) => attachment.type === 'image'
                    ? (
                      <img
                        key={`${attachment.value.previewUrl}:${index}`}
                        className={css.thumb}
                        src={attachment.value.previewUrl}
                        alt={t('queue.image')}
                      />
                    )
                    : (
                      <QueueFile
                        key={`${attachment.value.attachmentId}:${attachment.value.name}:${index}`}
                        attachment={attachment.value}
                        label={t('queue.file', { name: attachment.value.name })}
                      />
                    ))}
                </span>
              )}
              <span className={css.preview}>{submission.text}</span>
              <span className={css.status} role="status">{t('queue.sending')}</span>
              {queueMutable && <div className={css.actions}>
                <button type="button" className={css.action} aria-label={t('queue.edit')} title={t('queue.sending')} disabled>
                  <IconEditOutline16 size={14} />
                </button>
                <button type="button" className={css.action} aria-label={t('queue.remove')} title={t('queue.sending')} disabled>
                  <IconTrashOutline16 size={14} />
                </button>
                <button type="button" className={css.action} aria-label={t('queue.steer')} title={t('queue.sending')} disabled>
                  <IconSendOutline14 />
                </button>
              </div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions'],
  /**
   * Register the queue strip as the terminal input-dock entry (order 20).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
          loadImage: attachment => conversation.resolveImage(sessionId, attachment),
        }
      },
    }, QueueDock))
  },
}
