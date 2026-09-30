/**
 * Image-card material for `image_generate`.
 * Prefers durable image ContentBlocks; falls back to text `attachmentId=` envelopes.
 * Image-to-image also surfaces reference attachment ids from the call args so the
 * row gallery shows the source, not only the prompt / result.
 */

import type { ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import { isAttachmentAddress } from '@xrkseek/client-runtime/src/client/workspaces/path.ts'
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
  name?: string
}): ImageAttachmentRef {
  return {
    attachmentId: parsed.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: asImageMediaType(parsed.mime),
    bytes: parsed.bytes && parsed.bytes > 0 ? parsed.bytes : 1,
    width: parsed.width && parsed.width > 0 ? parsed.width : 1024,
    height: parsed.height && parsed.height > 0 ? parsed.height : 1024,
    name: parsed.name
      ?? `image_generate_${parsed.attachmentId.slice(-8)}.png`,
  }
}

/**
 * Normalize `sha256:…` / `attachment:sha256:…` to a Host attachment id.
 * HTTPS / data URLs are not attachment addresses — callers skip those.
 */
function normalizeAttachmentId(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!isAttachmentAddress(trimmed)) return undefined
  if (trimmed.toLowerCase().startsWith('attachment:')) {
    return trimmed.slice('attachment:'.length).trim() || undefined
  }
  return trimmed
}

/**
 * Collect edit / i2i reference attachment ids from `image_generate` args.
 * Prefer `reference_attachment_ids`; also accept `image_url` /
 * `reference_image_urls` when they name an attachment (not https).
 */
export function referenceAttachmentIdsFromArgs(argsRaw: string): string[] {
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
    args = parsed as Record<string, unknown>
  } catch {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: unknown): void => {
    if (typeof raw !== 'string') return
    const id = normalizeAttachmentId(raw)
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  if (Array.isArray(args.reference_attachment_ids)) {
    for (const item of args.reference_attachment_ids) push(item)
  }
  push(args.image_url)
  if (Array.isArray(args.reference_image_urls)) {
    for (const item of args.reference_image_urls) push(item)
  }
  return out
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

function galleryLabel(resultCount: number, referenceCount: number): string {
  const resultPart = resultCount === 0
    ? null
    : resultCount === 1 ? '1 image' : `${resultCount} images`
  const refPart = referenceCount === 0
    ? null
    : referenceCount === 1 ? '1 reference' : `${referenceCount} references`
  if (resultPart !== null && refPart !== null) return `${resultPart} · ${refPart}`
  return resultPart ?? refPart ?? 'images'
}

function resultImagesFromBlock(block: Extract<ToolCallBlock, { kind: string }>): {
  images: ImageAttachmentRef[]
  text: string
} {
  const contentRefs = refsFromContent(block.content)
  if (contentRefs.length > 0) {
    const text = textFromContent(block.content)
    const displayText = text
      ? parseImageGenResultText(text).displayText
      : (contentRefs.length === 1 ? '1 image' : `${contentRefs.length} images`)
    return { images: contentRefs, text: displayText }
  }
  const parsed = parseImageGenResultText(textFromContent(block.content))
  return {
    images: parsed.images.map((img) => stubRef(img)),
    text: parsed.displayText,
  }
}

/**
 * Build a gallery card for `image_generate`: result images when settled, plus
 * any i2i reference attachment ids from args (shown even while the call runs).
 */
export function imageGenCardModel(block: ToolCallBlock): ImageCardModel | null {
  const callName = 'kind' in block ? block.call?.name : block.name
  // When the call head was truncated out of the window, still try — the
  // keyed toolview / GenericToolCard already knows the wire name.
  if (callName !== undefined && callName !== 'image_generate') return null
  if ('kind' in block && block.isError) return null

  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  const referenceIds = referenceAttachmentIdsFromArgs(argsRaw)
  const referenceImages = referenceIds.map((attachmentId) => stubRef({
    attachmentId,
    name: `reference_${attachmentId.slice(-8)}.png`,
  }))

  let resultImages: ImageAttachmentRef[] = []
  let resultText = ''
  if ('kind' in block) {
    const settled = resultImagesFromBlock(block)
    resultImages = settled.images
    resultText = settled.text
  }

  if (resultImages.length === 0 && referenceImages.length === 0) return null

  // Results first so the collapsed thumb peeks the generated image when ready;
  // references follow so i2i still shows the source in the expanded gallery.
  const images = [
    ...resultImages.map((attachment) => ({ attachment, role: 'result' as const })),
    ...referenceImages.map((attachment) => ({ attachment, role: 'reference' as const })),
  ]
  return {
    label: galleryLabel(resultImages.length, referenceImages.length),
    images,
    text: resultText,
  }
}
