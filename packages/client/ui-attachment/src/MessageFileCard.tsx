/** Read-only file card for durable transcript blocks (composer FileCard twin). */

import clsx from 'clsx'
import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import { fileExtension, FileTypeIcon, fileSizeText } from '@xrkseek/client-ui-primitives'
import css from './FileCard.module.css'
import galleryCss from './MessageImage.module.css'

/**
 * One durable message file card: type glyph, basename, extension + size.
 * No remove/retry/progress — those belong only to the composer draft rail.
 */
export function MessageFileCard({ attachment }: {
  attachment: FileAttachmentRef
}) {
  const name = attachment.name
  return (
    <div className={clsx(css.card, css.cardMessage)} title={name}>
      <div className={css.icon} aria-hidden="true"><FileTypeIcon path={name} /></div>
      <div className={css.body}>
        <div className={css.name}>{name}</div>
        <div className={css.status}>
          {[fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(attachment.bytes)]
            .filter(Boolean).join(' ')}
        </div>
      </div>
    </div>
  )
}

/**
 * Wrapping file-card group for user (and pending-steering) history bubbles.
 * Empty lists render nothing so callers can pass the extracted parts blindly.
 */
export function MessageFileGallery({ files, align }: {
  files: readonly { attachment: FileAttachmentRef }[]
  align: 'start' | 'end'
}) {
  if (files.length === 0) return null
  return (
    <div className={galleryCss.gallery} data-align={align}>
      {files.map((file, index) => (
        <MessageFileCard
          key={`${file.attachment.attachmentId}:${index}`}
          attachment={file.attachment}
        />
      ))}
    </div>
  )
}
