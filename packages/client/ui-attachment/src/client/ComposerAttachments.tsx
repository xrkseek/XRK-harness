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

/**
 * Split a drop into ordinary files vs directories using `webkitGetAsEntry`.
 * When entry metadata is unavailable (jsdom / plain FileList), every item
 * stays in `files` — same as the legacy FileList-only path.
 */
function fileListOf(dataTransfer: DataTransfer): File[] {
  try {
    const list = dataTransfer.files
    if (list == null) return []
    return Array.from(list)
  } catch {
    return []
  }
}

function partitionDataTransfer(dataTransfer: DataTransfer): {
  readonly files: readonly File[]
  readonly directories: readonly File[]
} {
  const allFiles = fileListOf(dataTransfer)
  const items = dataTransfer.items
  if (items === undefined || items.length === 0) {
    return { files: allFiles, directories: [] }
  }
  const files: File[] = []
  const directories: File[] = []
  let classified = 0
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item === undefined || item.kind !== 'file') continue
    const entry =
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry === null) continue
    classified += 1
    const file = item.getAsFile() ?? allFiles[i]
    if (file === undefined) continue
    if (entry.isDirectory) directories.push(file)
    else files.push(file)
  }
  if (classified === 0) return { files: allFiles, directories: [] }
  return { files, directories }
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onAddDirectories, onRemoveImage, dropLimits, uploads, onRetryFile, t,
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
      try {
        dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
      } catch {
        // jsdom DataTransferPolyfill may expose a read-only dropEffect.
      }
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
      if (!canAcceptDrop) return
      const partitioned = partitionDataTransfer(dataTransfer)
      if (partitioned.directories.length > 0 && onAddDirectories !== undefined) {
        onAddDirectories(partitioned.directories)
      }
      if (partitioned.files.length > 0) onAddImages(partitioned.files)
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
  }, [canAcceptDrop, onAddDirectories, onAddImages])

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
