/**

 * Image-card material for `image_generate`.

 * Prefers durable image ContentBlocks; falls back to text `attachmentId=` envelopes.

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



function positiveInteger(value: unknown): value is number {

  return typeof value === 'number' && Number.isInteger(value) && value > 0

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



function refsFromContent(content: readonly unknown[]): ImageAttachmentRef[] | null {

  const refs: ImageAttachmentRef[] = []

  for (const part of content) {

    if (typeof part !== 'object' || part === null) continue

    const { type, attachment } = part as { type?: unknown; attachment?: unknown }

    if (type !== 'image') continue

    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) {

      return null

    }

    const {

      attachmentId, mediaType, bytes, width, height, name,

    } = attachment as Record<string, unknown>

    if (typeof attachmentId !== 'string' || attachmentId === '') return null

    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType)) return null

    if (!positiveInteger(bytes) || !positiveInteger(width) || !positiveInteger(height)) return null

    if (name !== undefined && typeof name !== 'string') return null

    refs.push({

      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],

      mediaType: mediaType as ImageMediaType,

      bytes,

      width,

      height,

      ...(name === undefined ? {} : { name }),

    })

  }

  return refs.length > 0 ? refs : null

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

  if (callName !== undefined && callName !== 'image_generate') return null



  const contentRefs = refsFromContent(block.content)

  if (contentRefs !== null) {

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



  const parsed = parseImageGenResultText(resultText(block))

  if (parsed.images.length === 0) return null

  const count = parsed.images.length

  return {

    label: count === 1 ? '1 image' : `${count} images`,

    images: parsed.images.map((img) => ({ attachment: stubRef(img) })),

    text: parsed.displayText,

  }

}


