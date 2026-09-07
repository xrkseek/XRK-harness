/** Pure image-card derivation from raw result content and metadata. @module */
import type { ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import { abbreviateHomePath, relativizeToCwd, type ToolCallBlock } from './tool-call-model.ts'

/**
 * The image-card material one settled call contributes: the display label plus
 * the durable references the attachment slot renders as a gallery.
 */
export interface ImageCardModel {
  /** Card label: the read path, shortened the way every other card's is. */
  label: string
  /** The durable images this result returned, in result order. */
  images: readonly { readonly attachment: ImageAttachmentRef }[]
  /**
   * The model-facing envelope text, for the line under the gallery.
   * Taken from the result's own text block rather than the row's flattened
   * result text (which would JSON.stringify the image block).
   */
  text: string
}

interface ImageMeta {
  path: string
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The envelope `formatImageReadOutput` writes, matched by shape. */
const IMAGE_ENVELOPE = /^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*\n<\/content>$/u

const IMAGE_MEDIA_TYPES: ReadonlySet<ImageMediaType> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.has(value as ImageMediaType)
}

function imageMeta(meta: unknown): ImageMeta | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const { path } = meta as Record<string, unknown>
  if (typeof path !== 'string' || path === '') return null
  return { path }
}

function parseCallArgs(block: ToolCallBlock): { name: string; args: Record<string, unknown> } | null {
  const call = 'kind' in block ? block.call : block
  if (call === null || call === undefined) return null
  const name = 'kind' in block ? call.name : block.name
  let value: unknown
  try {
    value = JSON.parse(call.argsRaw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return { name, args: value as Record<string, unknown> }
}

function imageReferences(content: readonly unknown[]): ImageAttachmentRef[] | null {
  const refs: ImageAttachmentRef[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, attachment } = part as { type?: unknown; attachment?: unknown }
    if (type !== 'image') continue
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) return null
    const {
      attachmentId, mediaType, bytes, width, height, name, originalDimensions,
    } = attachment as Record<string, unknown>
    if (typeof attachmentId !== 'string' || attachmentId === '') return null
    if (typeof mediaType !== 'string' || !isImageMediaType(mediaType)) return null
    if (!positiveInteger(bytes) || !positiveInteger(width) || !positiveInteger(height)) return null
    if (name !== undefined && typeof name !== 'string') return null
    // originalDimensions is protocol-only; gallery refs only need intrinsic size.
    if (originalDimensions !== undefined) {
      if (typeof originalDimensions !== 'object' || originalDimensions === null || Array.isArray(originalDimensions)) return null
      const { width: inputWidth, height: inputHeight } = originalDimensions as Record<string, unknown>
      if (!positiveInteger(inputWidth) || !positiveInteger(inputHeight)) return null
    }
    refs.push({
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType,
      bytes,
      width,
      height,
      ...name === undefined ? {} : { name },
    })
  }
  return refs.length > 0 ? refs : null
}

function imageTexts(content: readonly { type: string; text?: string }[]): string | null {
  const parts: string[] = []
  let sawEnvelope = false
  for (const part of content) {
    if (part.type !== 'text' || typeof part.text !== 'string') continue
    if (IMAGE_ENVELOPE.test(part.text)) sawEnvelope = true
    parts.push(part.text)
  }
  return sawEnvelope && parts.length > 0 ? parts.join('\n') : null
}

function fullyRendered(content: readonly unknown[]): boolean {
  return content.every((part) => {
    if (typeof part !== 'object' || part === null) return false
    const { type, text } = part as { type?: unknown; text?: unknown }
    return type === 'image' || (type === 'text' && typeof text === 'string')
  })
}

/**
 * Derive a settled image card after validating the call head, persisted
 * metadata (or its argument fallback), and the model-facing image envelope.
 * @param home - host account home; leftover POSIX home paths display as `~`.
 */
export function imageCardModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): ImageCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const call = parseCallArgs(block)
  if (call?.name !== 'read_image') return null
  const filePath = call.args.file_path
  if (typeof filePath !== 'string' || filePath.trim() === '') return null
  const path = imageMeta(block.meta)?.path ?? filePath
  if (!fullyRendered(block.content)) return null
  const refs = imageReferences(block.content)
  if (refs === null) return null
  const text = imageTexts(block.content)
  if (text === null) return null
  return {
    label: abbreviateHomePath(relativizeToCwd(path, sessionCwd), home),
    images: refs.map(ref => ({ attachment: ref })),
    text,
  }
}
