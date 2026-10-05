// Queue dock: Host queued rows plus pre-admit local queued echoes (「发送中」).
// Steer「插队中」stays on ChatView. FIFO claim promotes local echoes to
// transcript (ChatView) until durable user/message — this dock must not go
// empty while a follow-up is still in flight before Host admits.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
import type { Context } from '@xrkseek/cordis'
import { useEffect, useId, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PendingSubmission, SessionId } from '@xrkseek/client-runtime/client'
import type { FileAttachmentRef, ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import {
  FileTypeIcon, fileSizeText,
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconPaperclipOutline16, IconQueueOutline14, IconSendOutline14, IconTrashOutline16, Tooltip,
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

/** Encode one browser File as a Host prompt wire part (base64). */
async function encodeQueueFile(file: File): Promise<
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; data: string; name?: string; mediaType?: string }
> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  const data = btoa(binary)
  const name = file.name === '' ? undefined : file.name
  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      mediaType: file.type || 'image/png',
      data,
      ...(name === undefined ? {} : { name }),
    }
  }
  return {
    type: 'file',
    data,
    ...(name === undefined ? {} : { name }),
    ...(file.type === '' ? {} : { mediaType: file.type }),
  }
}

type EditingState = {
  readonly id: QueueItemId
  readonly text: string
  /** New uploads staged for this edit (not yet admitted). */
  readonly files: readonly File[]
}
/** Pending: dashed ring matching TodoPanel's unstarted glyph. */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}

/** Sending: business-blue ring fading out; CSS spins the svg. */
function SendingGlyph() {
  const gradientId = useId()
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphSending}>
      <defs>
        <linearGradient id={gradientId} x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="6.4" stroke={`url(#${gradientId})`} strokeWidth="1.2" />
    </svg>
  )
}

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

type DockRow =
  | { readonly kind: 'host'; readonly row: QueueRow }
  | { readonly kind: 'local'; readonly submission: PendingSubmission }

const NO_DOCK_ROWS: readonly DockRow[] = []

/**
 * Queue strip: Host queued rows plus pre-admit local queued echoes. Multiple
 * items default to a collapsible count header; an empty strip renders nothing.
 */
export function QueueDock({ useSession, updateQueue, notify, loadImage, t }: QueueDockProps) {
  const inbox = useSession(s => s.queue)
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  const dockRows = useMemo((): readonly DockRow[] => {
    // One pass each over inbox + pendingSubmissions (Vercel js-combine-iterations).
    const inChat = new Set<string>()
    const localQueued: PendingSubmission[] = []
    for (const item of pendingSubmissions) {
      if (item.placement === 'transcript') inChat.add(item.requestId)
      else if (item.placement === 'queued') localQueued.push(item)
    }
    const hostRows: DockRow[] = []
    const hostRpc = new Set<string>()
    for (const row of inbox) {
      if (row.placement !== 'queued') continue
      if (row.rpcId !== undefined) {
        hostRpc.add(row.rpcId)
        if (inChat.has(row.rpcId)) continue
      }
      hostRows.push({ kind: 'host', row })
    }
    const localRows: DockRow[] = []
    for (const submission of localQueued) {
      if (hostRpc.has(submission.requestId)) continue
      localRows.push({ kind: 'local', submission })
    }
    return hostRows.length === 0 && localRows.length === 0
      ? NO_DOCK_ROWS
      : [...hostRows, ...localRows]
  }, [inbox, pendingSubmissions])
  const rowCount = dockRows.length
  const running = useSession(s => s.running)
  // Continuable children share the Host session queue (edit / remove / steer);
  // one-shot stays a read-only projection of any residual inbox rows.
  const queueMutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()
  const fileInputId = useId()

  useEffect(() => {
    if (rowCount === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !dockRows.some(entry => (
      entry.kind === 'host' && entry.row.id === editing.id
    )))) setEditing(null)
  }, [collapsed, dockRows, editing, queueMutable, rowCount])

  if (rowCount === 0) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
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

  // Find the Host row being edited (local echoes are not editable).
  const editingHost = editing === null
    ? undefined
    : dockRows.find((entry): entry is Extract<DockRow, { kind: 'host' }> => (
      entry.kind === 'host' && entry.row.id === editing.id
    ))?.row

  const canSaveEdit = editing !== null && editingHost !== undefined && (() => {
    const kept = editingHost.content.filter(block => block.type === 'image' || block.type === 'file')
    return editing.text.trim() !== '' || kept.length > 0 || editing.files.length > 0
  })()

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editingHost === undefined) return
    const kept = editingHost.content.filter(block => block.type === 'image' || block.type === 'file')
    let uploaded: Awaited<ReturnType<typeof encodeQueueFile>>[] = []
    try {
      uploaded = await Promise.all(editing.files.map(encodeQueueFile))
    } catch {
      notify('error', t('queue.editFailed'))
      return
    }
    const text = editing.text
    const textParts = text.trim() === '' ? [] : [{ type: 'text' as const, text }]
    if (kept.length === 0 && uploaded.length === 0 && textParts.length === 0) return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [...kept, ...uploaded, ...textParts] as never },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <section className={css.root} data-queue-dock aria-label={t('queue.title')}>
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-controls={listId}
          aria-expanded={listVisible}
          disabled={interactionActive || rowCount === 1}
          onClick={() => { setCollapsed(value => !value) }}
        >
          <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
          <span className={css.title}>{t('queue.title')}</span>
          <span className={css.count}>{t('queue.count', { n: rowCount })}</span>
          {rowCount > 1 && (
            <span className={css.chevron} aria-hidden>
              {collapsed && !interactionActive ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            </span>
          )}
        </button>
        <ul id={listId} className={css.list} hidden={!listVisible}>
        {listVisible && dockRows.map(entry => (
          entry.kind === 'local'
            ? (
              <li key={`local:${entry.submission.requestId}`} className={css.row} data-status="sending" data-submission-echo>
                <span className={css.glyph} aria-hidden><SendingGlyph /></span>
                <LocalEchoAttachments submission={entry.submission} t={t} />
                <span className={css.preview}>{entry.submission.text}</span>
                <span className={css.status} role="status">{t('queue.sending')}</span>
                {queueMutable && (
                  <div className={css.actions}>
                    <button type="button" className={css.action} aria-label={t('queue.edit')} title={t('queue.sending')} disabled>
                      <IconEditOutline16 size={14} />
                    </button>
                    <button type="button" className={css.action} aria-label={t('queue.remove')} title={t('queue.sending')} disabled>
                      <IconTrashOutline16 size={14} />
                    </button>
                    <button type="button" className={css.action} aria-label={t('queue.steer')} title={t('queue.sending')} disabled>
                      <IconSendOutline14 />
                    </button>
                  </div>
                )}
              </li>
            )
            : (
              <HostQueueRow
                key={entry.row.id}
                row={entry.row}
                queueMutable={queueMutable}
                running={running}
                editing={editing}
                busy={busy}
                fileInputId={fileInputId}
                canSaveEdit={canSaveEdit}
                setEditing={setEditing}
                saveEdit={saveEdit}
                applyAction={applyAction}
                loadImage={loadImage}
                t={t}
              />
            )
        ))}
        </ul>
      </div>
    </section>
  )
}

function LocalEchoAttachments({
  submission,
  t,
}: {
  submission: PendingSubmission
  t: QueueDockProps['t']
}) {
  if (submission.attachments.length === 0) return null
  return (
    <span className={css.attachments}>
      {submission.attachments.map((item, index) => {
        if (item.type === 'image') {
          return (
            <img
              key={`img:${index}`}
              className={css.thumb}
              src={item.value.previewUrl}
              alt={item.value.name ?? t('queue.image')}
            />
          )
        }
        return (
          <QueueFile
            key={`file:${index}`}
            attachment={item.value}
            label={t('queue.file', { name: item.value.name })}
          />
        )
      })}
    </span>
  )
}

function HostQueueRow({
  row,
  queueMutable,
  running,
  editing,
  busy,
  fileInputId,
  canSaveEdit,
  setEditing,
  saveEdit,
  applyAction,
  loadImage,
  t,
}: {
  row: QueueRow
  queueMutable: boolean
  running: boolean
  editing: EditingState | null
  busy: QueueItemId | null
  fileInputId: string
  canSaveEdit: boolean
  setEditing: (next: EditingState | null) => void
  saveEdit: () => Promise<void>
  applyAction: (itemId: QueueItemId, action: QueueAction, failure: string) => Promise<boolean>
  loadImage: QueueDockInjected['loadImage']
  t: QueueDockProps['t']
}) {
  return (
    <li
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
      <span className={css.glyph} aria-hidden><PendingGlyph /></span>
      {editing?.id === row.id
        ? (
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
            {editing.files.length > 0 && (
              <span className={css.attachments} aria-label={t('queue.edit.staged')}>
                {editing.files.map((file, index) => (
                  <span key={`${file.name}:${index}`} className={css.file} title={file.name}>
                    <span className={css.fileName}>{file.name || t('queue.image')}</span>
                  </span>
                ))}
              </span>
            )}
            <input
              autoFocus
              className={css.editor}
              aria-label={t('queue.edit')}
              value={editing.text}
              onChange={(event) => {
                setEditing({
                  id: row.id,
                  text: event.currentTarget.value,
                  files: editing.files,
                })
              }}
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
          </>
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
      {queueMutable && (
        <div className={css.actions}>
          {editing?.id === row.id
            ? (
              <>
                <input
                  id={`${fileInputId}-${row.id}`}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const list = event.currentTarget.files
                    if (list === null || list.length === 0 || editing === null) return
                    setEditing({
                      id: editing.id,
                      text: editing.text,
                      files: [...editing.files, ...Array.from(list)],
                    })
                    event.currentTarget.value = ''
                  }}
                />
                <Tooltip label={t('queue.edit.attach')} side="bottom">
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.edit.attach')}
                    disabled={busy !== null}
                    onClick={() => {
                      document.getElementById(`${fileInputId}-${row.id}`)?.click()
                    }}
                  >
                    <IconPaperclipOutline16 size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('queue.save')} side="bottom">
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.save')}
                    disabled={busy !== null || !canSaveEdit}
                    onClick={() => { void saveEdit() }}
                  >
                    <IconCheckOutline16 size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('queue.cancelEdit')} side="bottom">
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
                <Tooltip label={t('queue.edit')} side="bottom">
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.edit')}
                    disabled={busy !== null}
                    onClick={() => {
                      setEditing({ id: row.id, text: row.text, files: [] })
                    }}
                  >
                    <IconEditOutline16 size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('queue.remove')} side="bottom">
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
                >
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.steer')}
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
        </div>
      )}
    </li>
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
