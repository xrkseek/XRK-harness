/** Draft generic-file card for the composer attachment rail (DSH-shaped). */

import clsx from 'clsx'
import { fileExtension, FileTypeIcon, fileSizeText, IconCloseFill14 } from '@xrkseek/client-ui-primitives'
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

/**
 * One generic-file draft card: type glyph, name, size/status, remove,
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
    : null
  const status = failed
    ? upload.message || labels.failed
    : uploading
      ? labels.uploading
      : [fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(file.size)]
        .filter(Boolean).join(' ')

  return (
    <div className={clsx(css.card, failed && css.cardFailed)}>
      <div className={css.icon} aria-hidden="true">
        {uploading
          ? <span className={css.spinner} />
          : <FileTypeIcon path={name} />}
      </div>
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
