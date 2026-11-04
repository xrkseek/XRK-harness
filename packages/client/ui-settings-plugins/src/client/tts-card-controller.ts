/** The TTS (text-to-speech) card's staged form over the `tts` namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import type { ClientRemote, VoiceSystemVoice } from '@xrkseek/xrk-api-remotes/client'
import { VOICE_OPENAI_REF, voiceEngineField } from './asr-card-controller.ts'
import {
  CardForm,
  booleanField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const TTS_NS = 'tts'

/**
 * TTS engines the card may stage. `edge` streams Microsoft neural voices over
 * WebSocket (free, no key), `local` renders with Host OS voices, `openai`
 * posts to an OpenAI-compatible `/audio/speech`.
 */
export type TtsEngine = 'edge' | 'local' | 'openai'

/** Host-served TTS section. */
export interface TtsSettings {
  /** Bind `text_to_speech` on every tool surface. */
  readonly enabled?: boolean
  readonly engine?: TtsEngine | string
  /** Optional OpenAI-compatible base URL (`/audio/speech`). */
  readonly baseUrl?: string
  /** Chinese/default row: OS voice name, Edge short name, or provider id. */
  readonly voice?: string
  /** English row; used for `en` clips and for `auto` calls that sniff as English. */
  readonly voiceEn?: string
  /** Spoken language: `auto` sniffs the text, `zh` / `en` pin a row. */
  readonly language?: 'auto' | 'zh' | 'en' | string
  /** OpenAI-compatible model; ignored by the local engine. */
  readonly model?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** The Host's OS voices, as `voice.voices` reports them. */
export interface TtsVoiceListState {
  /** False when the Host exposes no voice Remote (older Host / test double). */
  readonly readable: boolean
  readonly loading: boolean
  readonly voices: readonly VoiceSystemVoice[]
}

/** What the TTS card renders. */
export interface TtsCardState extends CardShell {
  readonly enabled: CardFieldState
  readonly engine: CardFieldState
  readonly baseUrl: CardFieldState
  readonly voice: CardFieldState
  readonly voiceEn: CardFieldState
  readonly language: CardFieldState
  readonly model: CardFieldState
  readonly apiKey: CardFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
  /**
   * Cloud engine is staged/enabled but Credentials has no key: the tool still
   * mounts, and every call fails honestly until one is set. The local engine
   * never needs a key.
   */
  readonly keyMissing: boolean
  /** Local-engine voice catalog (best-effort; empty means free-text voice). */
  readonly voices: TtsVoiceListState
}

/** The registration-side face the TTS card's slot entry injects. */
export interface TtsCardFace extends CardActions {
  hooks: {
    ttsCard: SnapshotStore<TtsCardState>
  }
  /** Re-read the engine's voice catalog (card open, engine switch, retry). */
  refreshVoices: (engine?: string) => void
}

const KEY_FIELD = 'apiKey'

/** Bridges the `tts` scope, the shared voice key, and the OS voice catalog. */
export class TtsCardController {
  private readonly form: CardForm<TtsSettings>
  private readonly store: SnapshotStore<TtsCardState>
  private key: CredentialState = { configured: false, writable: true }
  private voices: TtsVoiceListState
  private disposed = false

  /**
   * The Face voice namespace, or `undefined` while it is still mounting.
   *
   * Same rule as the ASR card: `remote` exists before `$bindFace` mounts the
   * namespaces, so a captured value is stale on every cold boot and the card
   * reports 「Host 没有列出任何语音」 for a Host that has voices.
   */
  private get remote(): ClientRemote['voice'] | undefined {
    return this.resolveRemote()
  }

  constructor(
    scope: SettingsScope<TtsSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly resolveRemote: () => ClientRemote['voice'] | undefined,
  ) {
    const remote = resolveRemote()
    this.voices = {
      readable: remote !== undefined,
      loading: remote !== undefined,
      voices: [],
    }
    this.form = new CardForm(
      scope,
      [
        booleanField('enabled'),
        voiceEngineField(),
        textField('baseUrl'),
        textField('voice'),
        textField('voiceEn'),
        textField('language'),
        textField('model'),
      ],
      [{ field: KEY_FIELD, write: (text) => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
    this.refreshVoices()
  }

  private projection(): TtsCardState {
    const engine = this.form.field('engine').text.trim() || 'edge'
    const enabled = this.form.field('enabled').text === 'true'
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      engine: this.form.field('engine'),
      baseUrl: this.form.field('baseUrl'),
      voice: this.form.field('voice'),
      voiceEn: this.form.field('voiceEn'),
      language: this.form.field('language'),
      model: this.form.field('model'),
      apiKey: this.form.field(KEY_FIELD),
      apiKeyConfigured: this.key.configured,
      apiKeyWritable: this.key.writable,
      keyMissing: enabled && engine === 'openai' && !this.key.configured,
      // Re-derived for the same reason as the ASR card's `local.readable`.
      voices: { ...this.voices, readable: this.resolveRemote() !== undefined },
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

  /** Re-read the engine's voice catalog; a failed probe leaves an empty list. */
  refreshVoices(engine?: string): void {
    if (this.disposed) return
    const remote = this.remote
    if (remote === undefined) return
    const selected = (engine ?? this.form.field('engine').text.trim()) || 'edge'
    void remote.voices({ engine: selected }).then(
      (result) => {
        if (this.disposed) return
        this.setVoices({
          readable: true,
          loading: false,
          voices: result.ok ? (result.value?.voices ?? []) : [],
        })
      },
      () => {
        if (this.disposed) return
        this.setVoices({ readable: true, loading: false, voices: [] })
      },
    )
  }

  /** Stop any work this controller owns (none today; symmetry with ASR). */
  dispose(): void {
    this.disposed = true
  }

  inject(): TtsCardFace {
    return {
      hooks: { ttsCard: this.store },
      ...this.form.actions(),
      refreshVoices: (engine?: string) => { this.refreshVoices(engine) },
    }
  }

  private setVoices(next: TtsVoiceListState): void {
    this.voices = next
    this.store.set(this.projection())
  }

  private async writeKey(value: string): Promise<boolean> {
    if (this.disposed) return false
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
