/**
 * File-card material for settled tool results that carry durable `file` blocks
 * or video_generate attachment envelopes (Codex-style media / document cards).
 */

import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parseVideoGenResultText } from './gen-result-parse.ts'

/** One tool-result file card (document / video / generic attachment). */
export interface FileCardModel {
  /** Short label above the cards (e.g. "1 file", "Video"). */
  readonly label: string
  /** Durable file refs in result order. */
  readonly files: readonly { readonly attachment: FileAttachmentRef }[]
  /** Model-facing envelope text under the cards. */
  readonly text: string
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return n > 0 ? n : undefined
  }
  return undefined
}

function textFromContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

/** Collect valid `type: "file"` ContentBlocks; skip malformed parts. */
export function fileRefsFromContent(content: readonly unknown[]): FileAttachmentRef[] {
  const refs: FileAttachmentRef[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, attachment } = part as { type?: unknown; attachment?: unknown }
    if (type !== 'file') continue
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) {
      continue
    }
    const { attachmentId, name, bytes, mediaType } = attachment as Record<string, unknown>
    if (typeof attachmentId !== 'string' || attachmentId === '') continue
    if (typeof name !== 'string' || name === '') continue
    const b = asPositiveInt(bytes)
    if (b === undefined) continue
    if (mediaType !== undefined && typeof mediaType !== 'string') continue
    refs.push({
      attachmentId: attachmentId as FileAttachmentRef['attachmentId'],
      name,
      bytes: b,
      ...(typeof mediaType === 'string' ? { mediaType } : {}),
    })
  }
  return refs
}

/**
 * Build file cards from durable `file` ContentBlocks on any settled tool result.
 */
export function fileCardModel(block: ToolCallBlock): FileCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const refs = fileRefsFromContent(block.content)
  if (refs.length === 0) return null
  const text = textFromContent(block.content)
  return {
    label: refs.length === 1 ? '1 file' : `${refs.length} files`,
    files: refs.map((attachment) => ({ attachment })),
    text,
  }
}

/**
 * Build a video media card from `video_generate` text envelopes when a durable
 * attachmentId (or file= leaf) is present.
 */
export function videoFileCardModel(block: ToolCallBlock): FileCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const callName = block.call?.name
  if (callName !== undefined && callName !== 'video_generate') return null

  // Prefer real file ContentBlocks when the Host emitted them.
  const fromBlocks = fileCardModel(block)
  if (fromBlocks !== null) {
    return { ...fromBlocks, label: fromBlocks.files.length === 1 ? '1 video' : `${fromBlocks.files.length} videos` }
  }

  const text = textFromContent(block.content)
  const parsed = parseVideoGenResultText(text)
  if (!parsed.attachmentId) return null
  const name = parsed.file
    ?? `video_generate_${parsed.attachmentId.slice(-8)}.mp4`
  const bytes = parsed.bytes !== undefined && parsed.bytes > 0 ? parsed.bytes : 1
  return {
    label: '1 video',
    files: [{
      attachment: {
        attachmentId: parsed.attachmentId as FileAttachmentRef['attachmentId'],
        name,
        bytes,
        ...(parsed.mime ? { mediaType: parsed.mime } : { mediaType: 'video/mp4' }),
      },
    }],
    text: parsed.displayText,
  }
}
