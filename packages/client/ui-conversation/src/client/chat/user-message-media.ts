/**
 * Reader-visible text + durable attachment refs from a user/steering message.
 * Edit-resubmit / regenerate / clipboard share one extraction so media is not
 * silently dropped when only `flattenText` / visible captions are copied.
 */
import type { FileAttachmentRef, ImageAttachmentRef } from '@xrkseek/xrk-attachment'

export type DurableMessageAttachment =
  | { readonly kind: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly kind: 'file'; readonly attachment: FileAttachmentRef }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function looksLikeAttachmentHandleCaption(text: string): boolean {
  const t = text.trim()
  return (
    /^\[图\d+\s+sha256:/i.test(t)
    || /^\[文件附件\s+/i.test(t)
    || /^\[image\s+\d+\s+sha256:/i.test(t)
    || /^\[file attachment\s+/i.test(t)
    || /^\[image omitted because this model accepts text only;/i.test(t)
  )
}

function isHiddenUserText(block: Record<string, unknown>): boolean {
  if (block.type !== 'text' || typeof block.text !== 'string') return false
  return block.modelOnly === true || looksLikeAttachmentHandleCaption(block.text)
}

function isImageAttachment(value: unknown): value is ImageAttachmentRef {
  if (!isRecord(value)) return false
  return typeof value.attachmentId === 'string'
    && value.attachmentId.length > 0
    && typeof value.mediaType === 'string'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
}

function isFileAttachment(value: unknown): value is FileAttachmentRef {
  if (!isRecord(value)) return false
  return typeof value.attachmentId === 'string'
    && value.attachmentId.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0
}

/** Visible user text blocks in prompt order (skips modelOnly handle captions). */
export function visibleUserTexts(content: readonly unknown[]): string[] {
  const texts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    if (isHiddenUserText(block)) continue
    texts.push(block.text)
  }
  return texts
}

/** Joined reader text (edit draft seed / regenerate). */
export function userMessageText(content: readonly unknown[]): string {
  // Paragraph breaks stay readable when a message has multiple prose blocks.
  return visibleUserTexts(content).join('\n')
}

/** Durable image/file refs in prompt order. */
export function durableAttachmentsIn(
  content: readonly unknown[],
): readonly DurableMessageAttachment[] {
  const out: DurableMessageAttachment[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'image' && isImageAttachment(block.attachment)) {
      out.push({ kind: 'image', attachment: block.attachment })
      continue
    }
    if (block.type === 'file' && isFileAttachment(block.attachment)) {
      out.push({ kind: 'file', attachment: block.attachment })
    }
  }
  return out
}

export function userMessageHasMedia(content: readonly unknown[]): boolean {
  return durableAttachmentsIn(content).length > 0
}

/**
 * Clipboard payload for copy: reader text plus a one-line pointer per media
 * part. Browsers cannot put arbitrary files on the clipboard from a button;
 * names keep the attachment discoverable when pasting elsewhere.
 */
export function clipboardTextForUserMessage(content: readonly unknown[]): string {
  const text = visibleUserTexts(content).join('\n\n')
  const media = durableAttachmentsIn(content)
  const lines: string[] = []
  if (text.trim() !== '') lines.push(text)
  for (const part of media) {
    if (part.kind === 'file') {
      lines.push(`[文件附件 ${part.attachment.name}]`)
      continue
    }
    const label = part.attachment.name?.trim() || part.attachment.attachmentId
    lines.push(`[图片 ${label}]`)
  }
  return lines.join('\n')
}

/**
 * Face `session.prompt` parts that reuse durable store ids (no re-upload).
 * Used by regenerate / edit-resubmit after truncate — bytes stay in the store.
 */
export function promptPartsFromDurableAttachments(
  media: readonly DurableMessageAttachment[],
): Array<
  | { type: 'image'; attachmentId: string; name?: string }
  | { type: 'file'; attachmentId: string }
> {
  return media.map((part) => {
    if (part.kind === 'file') {
      return { type: 'file' as const, attachmentId: part.attachment.attachmentId }
    }
    const name = part.attachment.name?.trim()
    return {
      type: 'image' as const,
      attachmentId: part.attachment.attachmentId,
      ...(name !== undefined && name !== '' ? { name } : {}),
    }
  })
}
