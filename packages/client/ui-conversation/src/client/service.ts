/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@xrkseek/cordis'
import type { Context } from '@xrkseek/cordis'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import type { ISessions, SessionFace, SessionId } from '@xrkseek/client-runtime/client'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type { SubmitImageAttachment, SubmitOutcome } from '@xrkseek/client-ui-input-trigger/client'
import type { AttachmentId, ImageAttachmentRef, ImageMediaType } from '@xrkseek/xrk-attachment'
import type {
  ComposerAttachment, ComposerFileAttachment, ComposerImageAttachment,
  DraftFileUpload, DraftFileUploads,
} from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './input/blocks.ts'
import { randomUuid } from '@xrkseek/xrk-host-apiproxy/api'
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns `ok` on success; `steer-queued` when steer lost the next-step window
   *   and the message remains queued for normal delivery.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<'ok' | 'steer-queued'>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
  /**
   * Page history backwards until the window covers `seq` (rail jump).
   * @param seq - Face event seq the window must reach.
   */
  loadThrough(seq: number): Promise<void>
  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string>
}

/**
 * Create one browser-only image draft; only its id enters input state.
 * The intrinsic size probe runs detached (never blocks the rail paint) and
 * writes back into the draft descriptor so the submission echo can size its
 * preview without a full-raster flash frame.
 */
function browserDraftImage(file: File): ComposerImageAttachment {
  const draft: ComposerImageAttachment = {
    kind: 'image',
    id: randomUuid() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
  void probeImageDimensions(draft)
  return draft
}

/** Create one browser-only file draft (bytes encode in the background). */
function browserDraftFile(file: File): ComposerFileAttachment {
  return {
    kind: 'file',
    id: randomUuid() as DraftAttachmentId,
    file,
  }
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  /** Live file-draft encode states (survives session switches until release). */
  readonly fileUploads = createSnapshotStore<DraftFileUploads>({})
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly fileEncodeControllers = new Map<DraftAttachmentId, AbortController>()
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      this.disposed = true
      for (const controller of this.fileEncodeControllers.values()) controller.abort()
      this.fileEncodeControllers.clear()
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftAttachments.clear()
      this.fileUploads.set({})
      this.imageUrls.clear()
      this.imageGenerations.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft attachments with text through one host admission.
   * Images encode at send; files use their background-ready base64.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local attachment ids (images and files).
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation failures reject.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft attachments are no longer available')
    }
    const uploads = this.fileUploads.getSnapshot()
    const pendingAttachments = attachments.map((attachment) => {
      if (attachment.kind === 'image') {
        return {
          type: 'image' as const,
          value: {
            previewUrl: attachment.previewUrl,
            ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
            ...(attachment.width === undefined ? {} : { width: attachment.width }),
            ...(attachment.height === undefined ? {} : { height: attachment.height }),
          },
        }
      }
      return {
        type: 'file' as const,
        value: {
          attachmentId: `echo:${attachment.id}` as AttachmentId,
          name: attachment.file.name || 'file',
          bytes: attachment.file.size,
          ...(attachment.file.type === '' ? {} : { mediaType: attachment.file.type }),
        },
      }
    })
    const serializeParts = async (): Promise<Parameters<SessionFace['prompt']>[0]> => {
      const content = await Promise.all(attachments.map(async (attachment) => {
        if (attachment.kind === 'image') {
          return { type: 'image' as const, ...await this.encodeImage(attachment.file) }
        }
        const upload = uploads[attachment.id]
        if (upload === undefined || upload.status !== 'ready') {
          throw new Error('conversation.sendSession: one or more files have not finished uploading')
        }
        return {
          type: 'file' as const,
          data: upload.data,
          ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
          ...(attachment.file.type === '' ? {} : { mediaType: attachment.file.type }),
        }
      }))
      return [...content, ...(text === '' ? [] : [{ type: 'text' as const, text }])]
    }
    if (session.getSnapshot().subagent !== null) {
      const parts = await serializeParts()
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      const result = await session.prompt(parts, mode, signal)
      if (!result.ok) return { kind: 'error' }
      this.releaseDraftImages(attachments)
      return { kind: 'success' }
    }
    const submission = session.beginSubmission({
      mode,
      text,
      attachments: pendingAttachments,
    })
    let parts: Parameters<SessionFace['prompt']>[0]
    try {
      await nextPaint()
      parts = await serializeParts()
    } catch (error) {
      submission.abandon()
      throw error
    }
    if (signal?.aborted) {
      submission.abandon()
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const result = await session.prompt(parts, mode, signal, submission.requestId)
    if (!result.ok) return { kind: 'error' }
    this.releaseDraftImages(attachments)
    return { kind: 'success' }
  }

  /**
   * Create runtime-only draft attachments. Image MIME types become image
   * drafts; every other file becomes a file draft whose background encode
   * starts immediately and remains owned across session navigation.
   * @param files - browser files to register.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
    return files.map((file) => {
      if (isAcceptedImageMediaType(file.type)) {
        const attachment = browserDraftImage(file)
        this.draftAttachments.set(attachment.id, attachment)
        this.createdImageUrls.add(attachment.previewUrl)
        return attachment
      }
      const attachment = browserDraftFile(file)
      this.draftAttachments.set(attachment.id, attachment)
      this.beginFileEncode(attachment)
      return attachment
    })
  }

  /**
   * Restart encoding for one failed file draft.
   * @param id - draft attachment id whose encode previously failed.
   */
  retryFileUpload(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined || attachment.kind !== 'file') return
    if (this.fileUploads.getSnapshot()[id]?.status !== 'error') return
    this.beginFileEncode(attachment)
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft attachments.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them. Generic file drafts are refused (commands do
   * not accept file attachments).
   * @param imageIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    if (attachments.some(attachment => attachment.kind === 'file')) {
      throw new Error('conversation.serializeDraftImages: file attachments are not supported on commands')
    }
    return Promise.all(attachments.map(attachment => this.encodeImage(attachment.file)))
  }

  /**
   * Release one browser-owned draft attachment and preview URL / encode.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    const controller = this.fileEncodeControllers.get(id)
    this.fileEncodeControllers.delete(id)
    controller?.abort()
    if (attachment.kind === 'image') {
      this.createdImageUrls.delete(attachment.previewUrl)
      revokePreview(attachment.previewUrl)
      return
    }
    const next = { ...this.fileUploads.getSnapshot() }
    delete next[id]
    this.fileUploads.set(next)
  }

  /**
   * Release a set of browser-owned draft attachments.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<'ok' | 'steer-queued'> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (action.kind === 'steer' && result.error.code === 'steer-unavailable') {
        return 'steer-queued'
      }
      if (
        action.kind === 'steer'
        && result.error.code === 'queue-item-not-found'
      ) {
        return 'ok'
      }
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
    return 'ok'
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Page history backwards until the window covers `seq`. */
  async loadThrough(seq: number): Promise<void> {
    await this.scopedSession('loadThrough').loadThrough(seq)
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Start (or restart) background base64 encode for one file draft. */
  private beginFileEncode(attachment: ComposerFileAttachment): void {
    this.fileEncodeControllers.get(attachment.id)?.abort()
    const controller = new AbortController()
    this.fileEncodeControllers.set(attachment.id, controller)
    this.patchFileUpload(attachment.id, { status: 'uploading', loaded: 0, total: attachment.file.size })
    void readFileAsBase64(attachment.file, controller.signal, (loaded, total) => {
      if (this.fileEncodeControllers.get(attachment.id) !== controller) return
      this.patchFileUpload(attachment.id, { status: 'uploading', loaded, total })
    }).then(
      (data) => {
        if (this.fileEncodeControllers.get(attachment.id) !== controller) return
        this.fileEncodeControllers.delete(attachment.id)
        this.patchFileUpload(attachment.id, { status: 'ready', data })
      },
      (error: unknown) => {
        if (this.fileEncodeControllers.get(attachment.id) !== controller) return
        this.fileEncodeControllers.delete(attachment.id)
        if (controller.signal.aborted) {
          this.patchFileUpload(attachment.id, undefined)
          return
        }
        this.patchFileUpload(attachment.id, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  private patchFileUpload(id: DraftAttachmentId, value: DraftFileUpload | undefined): void {
    const next = { ...this.fileUploads.getSnapshot() }
    if (value === undefined) delete next[id]
    else next[id] = value
    this.fileUploads.set(next)
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }
}

function isAcceptedImageMediaType(value: string): boolean {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(value)
}

/** The image MIME types this client can encode, as a single value-level source. */
const SUPPORTED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set<ImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function imageMediaType(value: string): ImageMediaType {
  // Single-source lookup: the guard and the encode share SUPPORTED_IMAGE_MEDIA_TYPES,
  // so the enumerated set can never drift between them. The throw stays as the
  // (now genuinely unreachable) defense for a caller that skipped the guard.
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(value)) {
    return value as ImageMediaType
  }
  throw new UnsupportedImageMediaTypeError(value)
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * Read one image draft's intrinsic dimensions off its object URL without
 * retaining large decoded rasters. `createImageBitmap` is the cheap probe
 * route; a legacy fallback spins a detached HTMLImageElement (closed over a
 * blob: URL, so no network) for browsers without it. The object URL is owned
 * by the draft descriptor — never revoked here.
 */
function probeImageDimensions(draft: ComposerImageAttachment): Promise<void> {
  const probe = typeof createImageBitmap === 'function'
    ? createImageBitmap(draft.file).then((bitmap) => {
      const width = bitmap.width
      const height = bitmap.height
      bitmap.close()
      return { width, height }
    })
    : new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image()
      image.onload = () => {
        const width = image.naturalWidth
        const height = image.naturalHeight
        resolve(width > 0 && height > 0 ? { width, height } : null)
      }
      image.onerror = () => resolve(null)
      image.src = draft.previewUrl
    })
  return probe.then((dimensions) => {
    if (dimensions !== null && draft.width === undefined && draft.height === undefined) {
      draft.width = dimensions.width
      draft.height = dimensions.height
    }
  }).catch(() => {
    // Intake is best-effort; the preview fallback keeps a probe-less echo bounded.
  })
}

/** Progressive FileReader encode with AbortSignal. */
function readFileAsBase64(
  file: File,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const reader = new FileReader()
    const onAbort = (): void => {
      reader.abort()
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
      else onProgress(event.loaded, file.size)
    }
    reader.onerror = () => {
      signal.removeEventListener('abort', onAbort)
      reject(reader.error ?? new Error('file read failed'))
    }
    reader.onabort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    reader.onload = () => {
      signal.removeEventListener('abort', onAbort)
      const buffer = reader.result
      if (!(buffer instanceof ArrayBuffer)) {
        reject(new Error('file read produced no ArrayBuffer'))
        return
      }
      onProgress(buffer.byteLength, buffer.byteLength)
      resolve(bytesToBase64(new Uint8Array(buffer)))
    }
    reader.readAsArrayBuffer(file)
  })
}

/** Yield one paint so the submission echo can render before serialization starts. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { resolve() })
    else setTimeout(resolve, 0)
  })
}
