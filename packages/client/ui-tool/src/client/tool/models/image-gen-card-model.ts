/**
 * Image-card material for `image_generate` from text `attachmentId=` envelopes.
 * Stub width/height when unknown — gallery load uses attachmentId only.
 */
import type { ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import type { ToolCallBlock } from './tool-call-model.ts'
import { resultText } from './tool-call-model.ts'
import type { ImageCardModel } from './image-card-model.ts'
import { parseImageGenResultText } from './gen-result-parse.ts'

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

function asImageMediaType(value: string | undefined): ImageMediaType {
  if (value && IMAGE_MEDIA_TYPES.has(value)) return value as ImageMediaType
  return 'image/png'
}

function stubRef(parsed: {
  attachmentId: string
  mime?: string
  bytes?: number
}): ImageAttachmentRef {
  return {
    attachmentId: parsed.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: asImageMediaType(parsed.mime),
    bytes: parsed.bytes && parsed.bytes > 0 ? parsed.bytes : 1,
    width: 1024,
    height: 1024,
    name: `image_generate_${parsed.attachmentId.slice(-8)}.png`,
  }
}

/**
 * Build a gallery card when `image_generate` settled with at least one attachmentId.
 */
export function imageGenCardModel(block: ToolCallBlock): ImageCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const callName = block.call?.name
  if (callName !== undefined && callName !== 'image_generate') return null
  const parsed = parseImageGenResultText(resultText(block))
  if (parsed.images.length === 0) return null
  const count = parsed.images.length
  return {
    label: count === 1 ? '1 image' : `${count} images`,
    images: parsed.images.map((img) => ({ attachment: stubRef(img) })),
    text: parsed.displayText,
  }
}
