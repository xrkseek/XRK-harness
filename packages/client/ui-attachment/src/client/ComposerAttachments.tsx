import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCloseFill14 } from '@xrkseek/client-ui-primitives'
import type {
  ComposerAttachment, ComposerAttachmentsProps, ComposerImageAttachment,
} from '@xrkseek/client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { FileCard } from '../FileCard.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, fileCardLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, uploads, onRetryFile, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<ComposerImageAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddImages([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddImages])

  const renderItem = useCallback((attachment: ComposerAttachment) => {
    if (attachment.kind === 'image') {
      const alt = attachment.file.name || t('image.pending')
      return (
        <div className={css.imageItem}>
          <button
            type="button"
            className={css.thumbnail}
            title={t('image.openOriginal')}
            onClick={() => { setPreview(attachment) }}
          >
            <img src={attachment.previewUrl} alt={alt} />
          </button>
          <button
            type="button"
            className={css.remove}
            aria-label={t('image.remove', { name: attachment.file.name })}
            onClick={() => { onRemoveImage(attachment.id) }}
          >
            <IconCloseFill14 size={12} />
          </button>
        </div>
      )
    }
    return (
      <FileCard
        file={attachment.file}
        upload={uploads[attachment.id]}
        labels={fileCardLabels(t, attachment.file.name)}
        onRemove={() => { onRemoveImage(attachment.id) }}
        onRetry={() => { onRetryFile(attachment.id) }}
      />
    )
  }, [onRemoveImage, onRetryFile, t, uploads])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {attachments.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={attachments}
            labels={attachmentRailLabels(t)}
            renderItem={renderItem}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
