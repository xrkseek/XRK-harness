import type { ContentBlock } from '@xrkseek/xrk-llm/types'
import type { MuxFrame, RpcId } from '@xrkseek/xrk-api-remotes/client'
import type { SessionEvent } from '@xrkseek/xrk-session/types'
import type { QueuedMessage } from './conversation.ts'
import { speechFamilyKey } from './transcript-chrome.ts'

const QUEUE_PREVIEW_CHARS = 200

/** Mirror protocol `looksLikeAttachmentHandleCaption` — keep queue prose clean. */
function looksLikeAttachmentHandleCaption(text: string): boolean {
  const t = text.trim()
  return (
    /^\[文件附件 .+（sha256:[a-f0-9]+/u.test(t)
    || /^\[图\d+\s+sha256:[a-f0-9]+/u.test(t)
    || /^\[File '.+' \(\d+ bytes, sha256:[a-f0-9]+/u.test(t)
    || /^\[image omitted because this model accepts text only;/u.test(t)
  )
}

function isHiddenQueueText(block: ContentBlock): boolean {
  if (block.type !== 'text') return true
  if ((block as { modelOnly?: unknown }).modelOnly === true) return true
  return looksLikeAttachmentHandleCaption(block.text)
}

function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .map(block => {
      if (block.type === 'text') return isHiddenQueueText(block) ? '' : block.text
      return `[${block.type}]`
    })
    .filter(part => part.length > 0)
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => (
      block.type === 'text' && !isHiddenQueueText(block)
    ))
    .map(block => block.text)
    .join('')
}

/**
 * Align local echo prose with Host queue text without blanking a typed body.
 * Image/file admits can briefly project empty `text` while blocks still carry
 * reader prose; overwriting the echo left 「插队中」 image-only until promote.
 * Non-empty Host text still wins (edit rewrite / re-list).
 */
export function preferQueueText(local: string, host: string): string {
  if (host === local) return local
  if (host.trim() === '') return local
  if (local.trim() === '') return host
  return host
}

type QueueUserMessageData = {
  readonly id?: unknown
  readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown }
  readonly rpcId?: unknown
  readonly rpcIds?: unknown
  readonly content?: readonly ContentBlock[]
}

/**
 * Client echo ids on a durable `user/message` (primary `rpcId` plus coalesced
 * sibling `rpcIds`). Shared by queue handoff and submission retirement.
 */
export function echoRpcIdsFromUserMessage(data: QueueUserMessageData): readonly string[] {
  const source = data.source
  // Prefer source.rpcId for any speech kind (user / seat / …). Fall back to
  // top-level data.rpcId when Face stamped only the event field.
  const sourceRpc =
    typeof source?.rpcId === 'string' && source.rpcId.length > 0
      ? source.rpcId
      : undefined
  const primary = sourceRpc
    ?? (typeof data.rpcId === 'string' && data.rpcId.length > 0 ? data.rpcId : undefined)
  const extras = Array.isArray(data.rpcIds)
    ? data.rpcIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (primary === undefined) return extras
  return extras.length === 0 ? [primary] : [primary, ...extras.filter(id => id !== primary)]
}

type QueueItems = Extract<MuxFrame, { type: 'session/queue' }>['items']

/** Authoritative transient queue projection and durable steering handoff. */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = []

  /**
   * Return the current immutable queue projection.
   * @returns current queue rows.
   */
  snapshot(): readonly QueuedMessage[] {
    return this.current
  }

  /**
   * Drop the stale generation before its replacement queue baseline arrives.
   * @returns whether any projected queue row was removed.
   */
  reset(): boolean {
    if (this.current.length === 0) return false
    this.current = []
    return true
  }

  /**
   * Replace from one authoritative stream queue frame.
   *
   * Attachment blocks are re-spread on every frame, so a naive map hands React a
   * new object identity each push. `MessageImage` keys its load effect on the
   * attachment identity, so that re-arms the effect — a pending thumbnail drops
   * back to its loading state on every queue publish. Carry the previous block
   * forward whenever its `attachmentId` still matches.
   *
   * @param items - complete host queue snapshot.
   */
  replace(items: QueueItems): void {
    const previous = new Map<string, ContentBlock>()
    for (const row of this.current) {
      for (const block of row.content) {
        const attachmentId = (block as { readonly attachment?: { readonly attachmentId?: unknown } })
          .attachment?.attachmentId
        if (typeof attachmentId === 'string') {
          previous.set(`${block.type}:${attachmentId}`, block)
        }
      }
    }
    this.current = items.map(item => {
      const source = item.message.source as { readonly kind?: unknown; readonly rpcId?: unknown } | undefined
      const rpcId = typeof source?.rpcId === 'string' && source.rpcId.length > 0
        ? source.rpcId as RpcId
        : undefined
      const content = item.message.content.map((block) => {
        if (block.type !== 'image' && block.type !== 'file') return block
        const attachmentId = block.attachment?.attachmentId
        if (attachmentId === undefined) return block
        const carried = previous.get(`${block.type}:${attachmentId}`)
        if (carried === undefined || carried.type !== block.type) return block
        return carried as typeof block
      })
      return {
        id: item.id,
        messageId: item.message.id,
        placement: item.placement,
        content,
        preview: previewOf(content),
        text: textOf(content),
        ...(rpcId === undefined ? {} : { rpcId }),
        // Pass-through Face admit source (handoff / seat / user). Dropping it
        // made pending steers paint as boss 「插队中」 until durable promote.
        ...(source === undefined ? {} : { source }),
      }
    })
  }

  /**
   * Apply a Host-accepted text edit before the next `session/queue` frame.
   * Keeps QueueDock preview aligned with the rewrite that ChatView's local
   * echo also patches — otherwise save→leaveEdit flashes the pre-edit body.
   *
   * @param itemId - queue row identity (admitId).
   * @param content - edit payload the client just sent (text + kept refs).
   * @returns whether a mirrored row was updated.
   */
  applyEdit(itemId: string, content: readonly ContentBlock[]): boolean {
    const index = this.current.findIndex(row => row.id === itemId)
    if (index < 0) return false
    const prev = this.current[index]!
    const nextContent = content.map((block) => {
      if (block.type !== 'image' && block.type !== 'file') return block
      const attachmentId = block.attachment?.attachmentId
      if (attachmentId === undefined) return block
      const carried = prev.content.find((candidate) => (
        candidate.type === block.type
        && (candidate as { readonly attachment?: { readonly attachmentId?: string } })
          .attachment?.attachmentId === attachmentId
      ))
      return (carried ?? block) as typeof block
    })
    const text = textOf(nextContent)
    const preview = previewOf(nextContent)
    if (text === prev.text && preview === prev.preview) return false
    this.current = [
      ...this.current.slice(0, index),
      { ...prev, content: nextContent, preview, text },
      ...this.current.slice(index + 1),
    ]
    return true
  }

  /**
   * Retire a transient steering row once its durable message enters the log.
   *
   * A steering row's `messageId` is its admitId — the Host promotes the admit
   * into a fresh `user/message` id, so comparing ids never matches and the row
   * lingered until the next queue publish. Match the row's prompt rpcId (the
   * source echo the durable event carries) so the row leaves in the same beat
   * its durable node arrives, and its local echo is never left painting alone.
   *
   * @param event - newly contiguous durable Session event.
   * @returns whether the projection changed.
   */
  acceptDurable(event: SessionEvent): boolean {
    if (event.type !== 'user/message') return false
    const data = event.data as QueueUserMessageData
    const echoIds = echoRpcIdsFromUserMessage(data)
    const echoSet = new Set(echoIds)
    const durableContent = Array.isArray(data.content) ? data.content : []
    const durableText = textOf(durableContent)
    const durableMedia = attachmentIdsOf(durableContent)
    const durableFamily = speechFamilyKey(data.source)
    // One durable user/message retires matching steering rows. Prefer rpcId
    // (admitId ≠ fresh messageId after promote). Rows that never got a source
    // rpcId still matched only by messageId before — that left a ghost 「插队中」
    // when Host listed the admit without rpcId while the durable already
    // painted (image+text steer → follow-up text was the common path).
    let retiredByMessageId = false
    let retiredByCover = false
    const next = this.current.filter((item) => {
      if (item.placement !== 'steering') return true
      if (item.rpcId !== undefined && echoSet.has(item.rpcId)) return false
      if (echoSet.size === 0 && !retiredByMessageId && item.messageId === data.id) {
        retiredByMessageId = true
        return false
      }
      // Durable already carries client echo ids, but this mirror row never got
      // source.rpcId (admit→queue race). messageId cannot match (fresh umsg_*).
      // Retire one covered row (reader text or every attachment id) so ChatView
      // does not keep a ghost 「插队中」 — image-only admits have empty `text`.
      // Same speech family only: a boss durable must not swallow a handoff row
      // via substring / shared media after family-partitioned promote.
      if (echoSet.size > 0 && item.rpcId === undefined && !retiredByCover) {
        if (speechFamilyKey(item.source) !== durableFamily) return true
        const textHit = item.text.length > 0
          && durableText.length > 0
          && (item.text === durableText || durableText.includes(item.text))
        const itemMedia = attachmentIdsOf(item.content)
        // Sets use `size`, not `length` — the latter left image-only ghosts forever.
        const mediaHit = itemMedia.size > 0
          && [...itemMedia].every(id => durableMedia.has(id))
        if (textHit || mediaHit) {
          retiredByCover = true
          return false
        }
      }
      return true
    })
    if (next.length === this.current.length) return false
    this.current = next
    return true
  }
}

function attachmentIdsOf(content: readonly ContentBlock[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const block of content) {
    if (block.type !== 'image' && block.type !== 'file') continue
    const id = block.attachment?.attachmentId
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return ids
}
