/** The ASR (speech-to-text) card's staged form over the `asr` namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import type {
  ClientRemote, VoiceLocalInspect, VoicePrepareState,
} from '@xrkseek/xrk-api-remotes/client'
import {
  CardForm,
  booleanField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const ASR_NS = 'asr'

/**
 * Credential ref for the OpenAI-compatible key. ASR and TTS share one key (and
 * one provider account), so both cards write the same slot.
 */
export const VOICE_OPENAI_REF = 'XRK_VOICE_OPENAI_KEY'

/** Engines the card may stage. `local` is SenseVoice on the Host. */
export type AsrEngine = 'local' | 'openai'

/** The slice of `ctx.remote.voice` this card drives. */
export type VoiceRemote = ClientRemote['voice']

/** Host-served ASR section. */
export interface AsrSettings {
  /** Bind the composer's dictation seat (desktop only). */
  readonly enabled?: boolean
  readonly engine?: AsrEngine | string
  /** Optional OpenAI-compatible base URL for `engine: openai`. */
  readonly baseUrl?: string
  /**
   * Optional HTTP proxy the model download should tunnel through
   * (`http://127.0.0.1:7897`). Empty means direct.
   */
  readonly downloadProxy?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/**
 * The local engine's two facts: what the Host says it needs, and whether a
 * transfer is running. `inspect` is undefined until the first read lands (or
 * when the Host refuses), which the card renders as "checking…", never as
 * "broken".
 *
 * `readable` is false when the Host exposes no voice Remote at all (an older
 * Host, or a test double without one): there is nothing to check, so the card
 * says so instead of spinning on a request that can never be answered.
 */
export interface VoiceLocalState {
  readonly readable: boolean
  readonly loading: boolean
  readonly inspect: VoiceLocalInspect | undefined
}

/** What the ASR card renders. */
export interface AsrCardState extends CardShell {
  readonly enabled: CardFieldState
  readonly engine: CardFieldState
  readonly baseUrl: CardFieldState
  readonly downloadProxy: CardFieldState
  readonly apiKey: CardFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
  /**
   * Cloud engine is staged/enabled but Credentials has no key —
   * transcription will fail honestly until a key is set.
   */
  readonly keyMissing: boolean
  /** Local-engine readiness + the download task, as the Host reports them. */
  readonly local: VoiceLocalState
}

/** The registration-side face the ASR card's slot entry injects. */
export interface AsrCardFace extends CardActions {
  hooks: {
    asrCard: SnapshotStore<AsrCardState>
  }
  /** Re-read readiness (card open, refresh link, or after a transfer settles). */
  refreshLocal: () => void
  /** Start the one-press download; the Host owns the transfer. */
  prepareLocal: () => void
  /** Abort an in-flight transfer. */
  cancelLocal: () => void
  /**
   * Transcribe one short trial clip through the same Host STT the composer
   * uses. Rejects with the Host's own reason (disabled, engine missing, …).
   */
  transcribeLocal: (audio: string, mimeType: string) => Promise<string>
}

/**
 * Engine ids either voice card may stage. `edge` belongs to TTS only, but the
 * picker (and its `format`/`parse` gate) is shared — leaving it out silently
 * rewrote a stored `edge` value to `local` on read AND refused it on save,
 * which is exactly why the TTS card showed 「本机（系统语音）」 over a
 * `tts.engine: edge` settings row.
 */
const ENGINES: readonly string[] = ['edge', 'local', 'openai']
const KEY_FIELD = 'apiKey'

/** A `local` / `openai` engine picker — the same two poles on both voice cards. */
export function voiceEngineField(): CardFieldSpec {
  return {
    field: 'engine',
    format: (value) => (
      typeof value === 'string' && (ENGINES as readonly string[]).includes(value)
        ? value
        : 'local'
    ),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'local'
      if (!(ENGINES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `asr` scope and the shared voice key onto the card. */
export class AsrCardController {
  private readonly form: CardForm<AsrSettings>
  private readonly store: SnapshotStore<AsrCardState>
  private key: CredentialState = { configured: false, writable: true }
  private local: VoiceLocalState
  /** Poll handle while a transfer runs; null when nothing is in flight. */
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  /** Consecutive transport failures; a flaky link must not poll forever. */
  private pollFailures = 0
  private disposed = false

  /**
   * The Face voice namespace, or `undefined` while it is still mounting.
   *
   * `remote` (the gateway service this fiber waits for) exists before
   * `$bindFace` mounts its namespaces, so a value captured in the constructor
   * is `undefined` on every cold boot — the card said 「this Host has no voice
   * interface」 while the composer's mic worked. Reading through a getter lets
   * a later `refreshLocal()` find the namespace once it lands.
   */
  private get remote(): VoiceRemote | undefined {
    return this.resolveRemote()
  }

  constructor(
    scope: SettingsScope<AsrSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly resolveRemote: () => VoiceRemote | undefined,
  ) {
    const remote = resolveRemote()
    this.local = {
      readable: remote !== undefined,
      // Nothing to ask when the Host has no voice Remote: stay out of "checking…".
      loading: remote !== undefined,
      inspect: undefined,
    }
    this.form = new CardForm(
      scope,
      [
        booleanField('enabled'),
        voiceEngineField(),
        textField('baseUrl'),
        textField('downloadProxy'),
      ],
      [{ field: KEY_FIELD, write: (text) => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
    // The card discloses local readiness on open, not on engine selection: a
    // user who already downloaded once must see "ready" without re-picking.
    this.refreshLocal()
  }

  private projection(): AsrCardState {
    const engine = this.form.field('engine').text.trim() || 'local'
    const enabled = this.form.field('enabled').text === 'true'
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      engine: this.form.field('engine'),
      baseUrl: this.form.field('baseUrl'),
      downloadProxy: this.form.field('downloadProxy'),
      apiKey: this.form.field(KEY_FIELD),
      apiKeyConfigured: this.key.configured,
      apiKeyWritable: this.key.writable,
      keyMissing: enabled && engine === 'openai' && !this.key.configured,
      // Readable is re-derived rather than stored: the namespace can mount
      // after this controller was built (see `remote` above), and a card stuck
      // on 「no voice interface」 once the service lands is worse than one that
      // said so briefly.
      local: { ...this.local, readable: this.resolveRemote() !== undefined },
    }
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [VOICE_OPENAI_REF] })
    } catch {
      return
    }
    if (!response.result.ok) return
    const row = response.result.value.credentials[VOICE_OPENAI_REF]
    const next: CredentialState = {
      configured: row?.configured ?? false,
      writable: row?.writable ?? true,
    }
    if (
      next.configured === this.key.configured
      && next.writable === this.key.writable
    ) {
      return
    }
    this.key = next
    this.store.set(this.projection())
  }

  refreshCredential(ref: string): void {
    if (ref !== VOICE_OPENAI_REF) return
    void this.readCredential()
  }

  /** Re-read local readiness; safe to call from a click or a settling transfer. */
  refreshLocal(): void {
    if (this.disposed || this.remote === undefined) return
    // Paint the read before the round-trip. A recheck that lands on the same
    // frozen failure (cancelled, failed) otherwise re-renders byte-identical
    // and the press reads as dead — the reported 「clicking recheck does
    // nothing」. The loading branch is the acknowledgement.
    if (!this.local.loading) this.setLocal({ ...this.local, loading: true })
    void this.remote.inspect().then(
      (result) => {
        if (this.disposed) return
        this.setLocal(result.ok
          ? { loading: false, inspect: result.value }
          : { loading: false, inspect: undefined })
        if (result.ok) this.syncPolling(result.value.prepare.phase)
      },
      () => {
        if (this.disposed) return
        this.setLocal({ loading: false, inspect: undefined })
      },
    )
  }

  /** Start (or join) the Host-owned transfer and begin reporting progress. */
  prepareLocal(): void {
    if (this.disposed || this.remote === undefined) return
    this.pollFailures = 0
    void this.remote.prepare().then(
      (result) => {
        if (this.disposed || !result.ok) return
        this.patchPrepare(result.value)
        this.syncPolling(result.value.phase)
      },
      () => undefined,
    )
  }

  /** Abort an in-flight transfer; the Host settles the snapshot. */
  cancelLocal(): void {
    if (this.disposed || this.remote === undefined) return
    void this.remote.prepareCancel().then(
      (result) => {
        if (this.disposed || !result.ok) return
        this.patchPrepare(result.value)
        this.syncPolling(result.value.phase)
      },
      () => undefined,
    )
  }

  /** Stop any timer this controller owns. */
  dispose(): void {
    this.disposed = true
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  private setLocal(next: VoiceLocalState): void {
    this.local = next
    this.store.set(this.projection())
  }

  /**
   * Replace just the transfer half of the snapshot. Readiness (`ready`) is
   * only recomputed by `refreshLocal`, because a finished download still needs
   * the binding probed before the engine as a whole is usable.
   */
  private patchPrepare(prepare: VoicePrepareState): void {
    const current = this.local.inspect
    if (current === undefined) return
    this.setLocal({
      loading: this.local.loading,
      inspect: { ...current, prepare },
    })
  }

  /** Keep a timer alive exactly while the Host reports a transfer in flight. */
  private syncPolling(phase: VoicePrepareState['phase']): void {
    if (phase === 'ready') {
      // Weights landed; re-read so `engine` and `assets.ready` agree.
      this.stopPolling()
      this.refreshLocal()
      return
    }
    if (phase !== 'preparing') {
      this.stopPolling()
      return
    }
    if (this.pollTimer !== null) return
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      if (this.disposed || this.remote === undefined) return
      void this.remote.prepareStatus().then(
        (result) => {
          if (this.disposed) return
          if (!result.ok) {
            this.notePollFailure()
            return
          }
          this.pollFailures = 0
          this.patchPrepare(result.value)
          this.syncPolling(result.value.phase)
        },
        () => { this.notePollFailure() },
      )
    }, 500)
  }

  private notePollFailure(): void {
    this.pollFailures += 1
    // Five bad reads in a row is a dead transport, not jitter; stop burning
    // requests and let the card's refresh action resume it.
    if (this.pollFailures >= 5) {
      this.stopPolling()
      return
    }
    this.syncPolling('preparing')
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return
    clearTimeout(this.pollTimer)
    this.pollTimer = null
  }

  inject(): AsrCardFace {
    return {
      hooks: { asrCard: this.store },
      ...this.form.actions(),
      refreshLocal: () => { this.refreshLocal() },
      prepareLocal: () => { this.prepareLocal() },
      cancelLocal: () => { this.cancelLocal() },
      transcribeLocal: async (audio, mimeType) => {
        if (this.remote === undefined) {
          throw new Error('this Host exposes no voice Remote')
        }
        // `probe` keeps the trial usable before the ASR switch is saved.
        const result = await this.remote.transcribe({ audio, mimeType, probe: true })
        if (!result.ok) throw new Error(result.error.message)
        return result.value.text
      },
    }
  }

  private async writeKey(value: string): Promise<boolean> {
    try {
      const response = await this.api.credentials.set({
        ref: VOICE_OPENAI_REF,
        value,
      })
      if (!response.result.ok) {
        await this.readCredential()
        return false
      }
    } catch {
      await this.readCredential()
      return false
    }
    await this.readCredential()
    return this.key.configured
  }
}
