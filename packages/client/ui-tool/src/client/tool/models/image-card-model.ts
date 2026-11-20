/** Pure image-card derivation from raw result content and metadata. @module */
import type { ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import {
  formatAttachmentSummary,
  isAttachmentAddress,
} from '@xrkseek/client-runtime/client'
import { abbreviateHomePath, relativizeToCwd, type ToolCallBlock } from './tool-call-model.ts'

/** Role of one gallery tile relative to an image_generate / read_image card. */
export type ImageCardRole = 'result' | 'reference'

/**
 * The image-card material one settled call contributes: the display label plus
 * the durable references the attachment slot renders as a gallery.
 */
export interface ImageCardModel {
  /** Card label: the read path, shortened the way every other card's is. */
  label: string
  /**
   * Durable images in display order. Results precede references so the
   * collapsed tool-row thumb peeks a generated image when both exist.
   */
  images: readonly {
    readonly attachment: ImageAttachmentRef
    readonly role?: ImageCardRole
  }[]
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

/**
 * Collect valid image refs; skip malformed parts instead of failing the whole
 * content path (mirrors image_generate — one bad block must not erase a gallery).
 */
function imageReferences(content: readonly unknown[]): ImageAttachmentRef[] | null {
  const refs: ImageAttachmentRef[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, attachment } = part as { type?: unknown; attachment?: unknown }
    if (type !== 'image') continue
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) {
      continue
    }
    const {
      attachmentId, mediaType, bytes, width, height, name, originalDimensions,
    } = attachment as Record<string, unknown>
    if (typeof attachmentId !== 'string' || attachmentId === '') continue
    if (typeof mediaType !== 'string' || !isImageMediaType(mediaType)) continue
    const b = asPositiveInt(bytes)
    const w = asPositiveInt(width)
    const h = asPositiveInt(height)
    if (b === undefined || w === undefined || h === undefined) continue
    if (name !== undefined && typeof name !== 'string') continue
    // originalDimensions is protocol-only; gallery refs only need intrinsic size.
    if (originalDimensions !== undefined) {
      if (typeof originalDimensions !== 'object' || originalDimensions === null || Array.isArray(originalDimensions)) {
        continue
      }
      const { width: inputWidth, height: inputHeight } = originalDimensions as Record<string, unknown>
      if (asPositiveInt(inputWidth) === undefined || asPositiveInt(inputHeight) === undefined) continue
    }
    refs.push({
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType,
      bytes: b,
      width: w,
      height: h,
      ...name === undefined ? {} : { name },
    })
  }
  return refs.length > 0 ? refs : null
}

function fullyRendered(content: readonly unknown[]): boolean {
  return content.every((part) => {
    if (typeof part !== 'object' || part === null) return false
    const { type, text } = part as { type?: unknown; text?: unknown }
    return type === 'image' || (type === 'text' && typeof text === 'string')
  })
}

function displayImagePath(path: string, sessionCwd?: string, home?: string): string {
  if (isAttachmentAddress(path)) return formatAttachmentSummary(path)
  return abbreviateHomePath(relativizeToCwd(path, sessionCwd), home)
}

/** Paths from `present` args.files (object `{ path }` or legacy string entries). */
function presentFilePaths(args: Record<string, unknown> | undefined): string[] {
  if (args === undefined) return []
  const files = args.files
  if (!Array.isArray(files)) {
    return typeof args.path === 'string' && args.path.trim() !== '' ? [args.path.trim()] : []
  }
  const paths: string[] = []
  for (const entry of files) {
    if (typeof entry === 'string' && entry.trim() !== '') paths.push(entry.trim())
    else if (typeof entry === 'object' && entry !== null) {
      const path = (entry as { path?: unknown }).path
      if (typeof path === 'string' && path.trim() !== '') paths.push(path.trim())
    }
  }
  return paths
}

/**
 * Card label for a gallery: single path when known; empty for multi-file
 * `present` (header fileLinks own the paths); attachment name as last resort.
 */
function galleryPathLabel(
  name: string,
  args: Record<string, unknown> | undefined,
  metaPath: string,
  refs: readonly ImageAttachmentRef[],
): string {
  if (name === 'present') {
    const paths = presentFilePaths(args)
    // Multi-file: no gallery label — ToolRow header lists every path.
    if (paths.length > 1) return ''
    if (paths.length === 1) return paths[0]!
    if (metaPath !== '') return metaPath
    return refs.length === 1 ? (refs[0]?.name ?? '') : ''
  }
  if (metaPath !== '') return metaPath
  if (name === 'read_image') {
    const filePath = args?.file_path
    if (typeof filePath === 'string' && filePath.trim() !== '') return filePath.trim()
  }
  return refs[0]?.name ?? 'image'
}

/**
 * Derive a settled image card after validating the call head, persisted
 * metadata (or its argument fallback), and durable image content blocks.
 * @param home - host account home; leftover POSIX home paths display as `~`.
 */
export function imageCardModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): ImageCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const call = parseCallArgs(block)
  const name = call?.name
  // read_image + present: both may carry durable image ContentBlocks.
  if (name !== 'read_image' && name !== 'present') return null
  if (!fullyRendered(block.content)) return null
  // Durable image blocks are the gallery signal. Do not gate on the model
  // envelope text: Windows Host builds used to emit `\r\n` envelopes that
  // failed an LF-only regex and fell back to IN/OUT with no preview.
  const refs = imageReferences(block.content)
  if (refs === null) return null
  const pathLabel = galleryPathLabel(
    name,
    call?.args,
    imageMeta(block.meta)?.path ?? '',
    refs,
  )
  return {
    label: pathLabel === '' ? '' : displayImagePath(pathLabel, sessionCwd, home),
    images: refs.map(ref => ({ attachment: ref, role: 'result' as const })),
    text: '',
  }
}
