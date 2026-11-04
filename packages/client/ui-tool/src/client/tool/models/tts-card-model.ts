/**
 * TTS-card material for `text_to_speech`.
 *
 * The Host has two result shapes and both must read honestly:
 *
 * - with an attachment store it appends a durable `file` ContentBlock and
 *   repeats the facts in the model-facing envelope
 *   (`provider=… mime=… voice=… bytes=… attachmentId=…`);
 * - without one it can only return a truncated `audio_base64=` preview, which
 *   nothing can play — the row says so instead of printing the preview.
 *
 * Either half can be missing while versions roll: the envelope may not carry
 * `voice=` yet, and a text-only Host still names an attachmentId. So the file
 * block wins, the envelope is the fallback, and a clip is "playable" only when
 * one of them produced a durable address.
 */

import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import { isAttachmentAddress } from '@xrkseek/client-runtime/client'
import type { ToolCallBlock } from './tool-call-model.ts'
import { fileRefsFromContent } from './file-card-model.ts'

/** Parsed facts of one settled `text_to_speech` result. */
export interface TtsCardModel {
  /** Durable clip; null when the Host only produced a base64 preview. */
  readonly attachment: FileAttachmentRef | null
  /** Engine id from the envelope (`edge`, `openai`, …). */
  readonly provider: string | null
  /** Provider voice id (`zh-CN-XiaoxiaoNeural`). */
  readonly voice: string | null
  readonly mime: string | null
  /** Envelope facts worth showing under the player, ids/base64 excluded. */
  readonly meta: string
  /** True when the result carried a truncated `audio_base64=` preview only. */
  readonly truncated: boolean
}

/** Containers the Host can hand back for a synthesized clip. */
const AUDIO_EXTENSION = /\.(mp3|wav|opus|ogg|webm|m4a|flac|aac)$/i

/** Display names for the common Edge voices (the rest fall back to the id). */
const VOICE_NAMES: Record<string, string> = {
  xiaoxiao: '晓晓',
  xiaoyi: '晓伊',
  yunxi: '云希',
  yunyang: '云扬',
  yunjian: '云健',
  xiaochen: '晓辰',
  xiaohan: '晓涵',
  xiaomeng: '晓梦',
  xiaomo: '晓墨',
  xiaoqiu: '晓秋',
  xiaorui: '晓睿',
  xiaoshuang: '晓双',
  xiaoxuan: '晓萱',
  xiaoyan: '晓颜',
  xiaoyou: '晓悠',
  yunfeng: '云枫',
  yunhao: '云皓',
  yunjie: '云杰',
  yunye: '云野',
  yunze: '云泽',
  xiaobei: '晓北',
  yunxia: '云夏',
  yunze2: '云泽',
}

/** True when a stored ref is (or looks like) audio the browser can play. */
export function isAudioAttachment(attachment: FileAttachmentRef): boolean {
  if (attachment.mediaType !== undefined && attachment.mediaType.toLowerCase().startsWith('audio/')) {
    return true
  }
  return AUDIO_EXTENSION.test(attachment.name)
}

/**
 * Split the envelope into `key=value` facts. The Host packs several facts on
 * one line (`provider=edge delivery=edge mime=audio/mpeg`), so the token — not
 * the line — is the unit; prose and trailing preview hints have no `=` and are
 * dropped. `audio_base64` is stored as a marker: the row must never hold the
 * payload, and a preview's `(1132 chars)` tail never becomes a fact.
 * @param text - result text blocks joined with newlines.
 * @returns first value wins per key.
 */
function envelopeFacts(text: string): Map<string, string> {
  const facts = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      const at = token.indexOf('=')
      if (at <= 0) continue
      const key = token.slice(0, at)
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || facts.has(key)) continue
      facts.set(key, key === 'audio_base64' ? '' : token.slice(at + 1))
    }
  }
  return facts
}

/** Voice requested on the call, which the envelope may not echo yet. */
function voiceFromArgs(argsRaw: string): string | null {
  try {
    const args = JSON.parse(argsRaw) as { voice?: unknown }
    return typeof args.voice === 'string' && args.voice.trim() !== '' ? args.voice.trim() : null
  } catch {
    return null
  }
}

/**
 * Cut the address out of an envelope value that ran into the model-only file
 * handle. Older session logs were flattened with no separator, so they carry
 * `attachmentId=sha256:<hex>[File '…' (… bytes, …) was uploaded…` — the id is
 * still the durable prefix, and replaying that row must stay playable.
 * @param raw - envelope value, possibly followed by handle prose.
 * @returns the address prefix, or undefined when the value held none.
 */
function cleanAttachmentAddress(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const match = /^[A-Za-z0-9:_-]+/.exec(raw.trim())
  return match === null ? undefined : match[0]
}

/** Bytes as a positive integer, or undefined for junk / zero. */
function positiveBytes(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const bytes = Number(raw)
  return bytes > 0 ? bytes : undefined
}

/** Result text blocks joined for envelope parsing. */
function textFromContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

/**
 * Build the TTS card model from a settled call.
 * @param block - running or settled call slice.
 * @returns the model, or null while running / failed / for another tool.
 */
export function ttsCardModel(block: ToolCallBlock): TtsCardModel | null {
  const callName = 'kind' in block ? block.call?.name : block.name
  // A windowless result loses the call head; the keyed toolview already knows
  // the wire name, so only a present and different name disqualifies the row.
  if (callName !== undefined && callName !== 'text_to_speech') return null
  if (!('kind' in block) || block.isError) return null

  const argsRaw = block.call?.argsRaw ?? ''
  const text = textFromContent(block.content)
  const facts = envelopeFacts(text)
  const refs = fileRefsFromContent(block.content)
  // Prefer a real audio block; a same-call document block is not a clip.
  const fromBlocks = refs.find(isAudioAttachment) ?? null

  const address = cleanAttachmentAddress(facts.get('attachmentId'))
  const mime = fromBlocks?.mediaType ?? facts.get('mime') ?? null
  const envelopeBytes = positiveBytes(facts.get('bytes'))
  // `exactOptionalPropertyTypes`: an absent mediaType must be absent, not
  // present-and-undefined, so the branch shapes the object instead of spreading.
  const envelopeRef: FileAttachmentRef | null = (() => {
    if (address === undefined || !isAttachmentAddress(address)) return null
    // The text envelope is the legacy carrier. A clip without its byte count is
    // a corrupt envelope, and a fabricated size (the old `?? 1`) would draw a
    // playable-looking bar over nothing.
    if (envelopeBytes === undefined) return null
    const base = {
      // The `file` block's id is the branded storage id; an envelope only ever
      // carries its string spelling, so the reference is the parse boundary.
      attachmentId: address as FileAttachmentRef['attachmentId'],
      name: facts.get('name') ?? 'tts.mp3',
      bytes: envelopeBytes,
    }
    return mime === null ? base : { ...base, mediaType: mime }
  })()

  const attachment = fromBlocks ?? envelopeRef
  const meta = [
    facts.get('provider'),
    mime,
    fromBlocks !== null && positiveBytes(facts.get('bytes')) === undefined
      ? `${fromBlocks.bytes} B`
      : null,
  ].filter((part): part is string => typeof part === 'string' && part !== '').join(' · ')

  return {
    attachment,
    provider: facts.get('provider') ?? null,
    voice: facts.get('voice') ?? voiceFromArgs(argsRaw),
    mime,
    meta,
    truncated: attachment === null && facts.has('audio_base64'),
  }
}

/**
 * Human display name of a provider voice (`zh-CN-XiaoxiaoNeural` → `晓晓`).
 * @param voice - provider voice id, or null when the result never named one.
 * @returns the display name, or null when there is nothing to show.
 */
export function voiceDisplayName(voice: string | null): string | null {
  if (voice === null || voice === '') return null
  // Edge ids are `<lang>-<region>-<Name>Neural` (some carry a locale variant:
  // `zh-CN-liaoning-XiaobeiNeural`), so the name is the last segment.
  const segment = voice.split('-').pop() ?? voice
  const stem = segment.replace(/Neural$/i, '')
  if (stem === '') return voice
  return VOICE_NAMES[stem.toLowerCase()] ?? stem
}

/** Clock time for the player (`0:07`, `1:05`). */
export function formatClipTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

/**
 * Duration in the collapsed summary: `7.3s` under a minute (the precision a
 * sentence of speech actually has), clock time above it.
 * @param seconds - clip duration from the audio element.
 * @returns the display text.
 */
export function formatClipSummary(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds >= 60) return formatClipTime(seconds)
  // One decimal, no trailing `.0`.
  return `${Number(seconds.toFixed(1))}s`
}
