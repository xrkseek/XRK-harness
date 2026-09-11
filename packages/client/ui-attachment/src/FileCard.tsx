/** Draft generic-file card for the composer attachment rail (DSH-shaped audit). */

import clsx from 'clsx'
import { IconCloseFill14 } from '@xrkseek/client-ui-primitives'
import type { DraftFileUpload } from '@xrkseek/client-ui-conversation/client'
import css from './FileCard.module.css'

/** Resolved strings for one file card. */
export interface FileCardLabels {
  /** Accessible label of the remove control. */
  remove: string
  /** Status line while encoding is in flight. */
  uploading: string
  /** Status line after encoding failed. */
  failed: string
  /** Retry control after a failure. */
  retry: string
  /** Fallback name when the file has no basename. */
  pending: string
}

/** Uppercase extension badge text (no dedicated file-type icon). */
function extensionLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1, dot + 5).toUpperCase()
}

/** Compact byte count for the card subtitle. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024
    return `${Number.isInteger(kb) ? String(kb) : kb.toFixed(1)}KB`
  }
  return `${bytes}B`
}

/**
 * One generic-file draft card: extension badge, name, size/status, remove,
 * optional retry, and an upload progress bar.
 */
export function FileCard({ file, upload, labels, onRemove, onRetry }: {
  file: File
  upload: DraftFileUpload | undefined
  labels: FileCardLabels
  onRemove: () => void
  onRetry: () => void
}) {
  const name = file.name || labels.pending
  const failed = upload?.status === 'error'
  const uploading = upload?.status === 'uploading'
  const progress = uploading && upload.total !== undefined && upload.total > 0
    ? Math.min(100, Math.round((upload.loaded / upload.total) * 100))
    : uploading ? null : null
  const status = failed
    ? upload.message || labels.failed
    : uploading
      ? labels.uploading
      : formatFileSize(file.size)

  return (
    <div className={clsx(css.card, failed && css.cardFailed)}>
      <div className={css.icon} aria-hidden="true">{extensionLabel(name)}</div>
      <div className={css.body}>
        <div className={css.name} title={name}>{name}</div>
        <div className={css.status}>{status}</div>
      </div>
      {failed && (
        <button type="button" className={css.retry} onClick={onRetry}>
          {labels.retry}
        </button>
      )}
      <button
        type="button"
        className={css.remove}
        aria-label={labels.remove}
        onClick={onRemove}
      >
        <IconCloseFill14 size={12} />
      </button>
      {uploading && (
        <div className={css.progressTrack} aria-hidden="true">
          <div
            className={css.progressFill}
            style={{ width: progress === null ? '30%' : `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
