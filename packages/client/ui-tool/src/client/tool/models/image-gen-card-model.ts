/**
 * Image-card material for `image_generate`.
 * Prefers durable image ContentBlocks; falls back to text `attachmentId=` envelopes.
 */

import type { ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import type { ToolCallBlock } from './tool-call-model.ts'
import type { ImageCardModel } from './image-card-model.ts'
import { parseImageGenResultText } from './gen-result-parse.ts'

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

function asImageMediaType(value: string | undefined): ImageMediaType {
  if (value && IMAGE_MEDIA_TYPES.has(value)) return value as ImageMediaType
  return 'image/png'
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Coerce wire numbers that arrived as floats (e.g. JSON with 1254.0). */
function asPositiveInt(value: unknown): number | undefined {
  if (positiveInteger(value)) return value
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return n > 0 ? n : undefined
  }
  return undefined
}

function stubRef(parsed: {
  attachmentId: string
  mime?: string
  bytes?: number
  width?: number
  height?: number
}): ImageAttachmentRef {
  return {
    attachmentId: parsed.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: asImageMediaType(parsed.mime),
    bytes: parsed.bytes && parsed.bytes > 0 ? parsed.bytes : 1,
    width: parsed.width && parsed.width > 0 ? parsed.width : 1024,
    height: parsed.height && parsed.height > 0 ? parsed.height : 1024,
    name: `image_generate_${parsed.attachmentId.slice(-8)}.png`,
  }
}

/**
 * Collect valid image refs; skip malformed parts instead of failing the whole
 * content path (one bad block must not erase a good gallery).
 */
function refsFromContent(content: readonly unknown[]): ImageAttachmentRef[] {
  const refs: ImageAttachmentRef[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, attachment } = part as { type?: unknown; attachment?: unknown }
    if (type !== 'image') continue
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) {
      continue
    }
    const {
      attachmentId, mediaType, bytes, width, height, name,
    } = attachment as Record<string, unknown>
    if (typeof attachmentId !== 'string' || attachmentId === '') continue
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType)) continue
    const b = asPositiveInt(bytes)
    const w = asPositiveInt(width)
    const h = asPositiveInt(height)
    if (b === undefined || w === undefined || h === undefined) continue
    if (name !== undefined && typeof name !== 'string') continue
    refs.push({
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: mediaType as ImageMediaType,
      bytes: b,
      width: w,
      height: h,
      ...(name === undefined ? {} : { name }),
    })
  }
  return refs
}

function textFromContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

/**
 * Build a gallery card when `image_generate` settled with image blocks or attachmentId lines.
 */
export function imageGenCardModel(block: ToolCallBlock): ImageCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const callName = block.call?.name
  // When the call head was truncated out of the window, still try — the
  // keyed toolview / GenericToolCard already knows the wire name.
  if (callName !== undefined && callName !== 'image_generate') return null

  const contentRefs = refsFromContent(block.content)
  if (contentRefs.length > 0) {
    const text = textFromContent(block.content)
    const displayText = text
      ? parseImageGenResultText(text).displayText
      : (contentRefs.length === 1 ? '1 image' : `${contentRefs.length} images`)
    return {
      label: contentRefs.length === 1 ? '1 image' : `${contentRefs.length} images`,
      images: contentRefs.map((attachment) => ({ attachment })),
      text: displayText,
    }
  }

  // Text blocks only — never JSON.stringify image ContentBlocks into the parser.
  const parsed = parseImageGenResultText(textFromContent(block.content))
  if (parsed.images.length === 0) return null
  const count = parsed.images.length
  return {
    label: count === 1 ? '1 image' : `${count} images`,
    images: parsed.images.map((img) => ({ attachment: stubRef(img) })),
    text: parsed.displayText,
  }
}
