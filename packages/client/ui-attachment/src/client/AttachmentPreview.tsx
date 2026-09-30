/** One-shot Host-attachment lightbox for chat openFile (sha256 / attachment: ids). */

import { useEffect, useState } from 'react'
import type { AttachmentPreviewProps } from '@xrkseek/client-ui-conversation/client'
import { formatAttachmentSummary } from '@xrkseek/client-runtime/client'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { lightboxLabels } from './labels.ts'

/**
 * Load one durable attachment and open ImageLightbox. Used when the user
 * clicks a read_image / tool-row summary that names a Host attachment id.
 */
export function AttachmentPreview({
  attachment, loadImage, onClose, t,
}: AttachmentPreviewProps) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    void loadImage(attachment).then(
      (url) => { if (alive) setSrc(url) },
      () => { if (alive) onClose() },
    )
    return () => { alive = false }
  }, [attachment, loadImage, onClose])
  if (src === null) return null
  const alt = attachment.name
    ?? formatAttachmentSummary(String(attachment.attachmentId))
  return (
    <ImageLightbox
      src={src}
      alt={alt}
      labels={lightboxLabels(t)}
      onClose={onClose}
    />
  )
}
