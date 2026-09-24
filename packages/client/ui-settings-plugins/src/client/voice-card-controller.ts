/** The voice card's staged form over the `voice` namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  textField,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const VOICE_NS = 'voice'

/** Credential ref for the OpenAI-compatible API key. */
export const VOICE_OPENAI_REF = 'XRK_VOICE_OPENAI_KEY'

/** Modes the card may stage. */
export type VoiceMode = 'off' | 'openai'

/** Host-served voice section. */
export interface VoiceSettings {
  readonly mode?: VoiceMode | string
  readonly baseUrl?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** What the voice card renders. */
export interface VoiceCardState extends CardShell {
  readonly mode: CardFieldState
  readonly baseUrl: CardFieldState
  readonly apiKey: CardFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
  /**
   * OpenAI mode is staged/saved but Credentials has no key —
   * tools will fail honestly until a key is set.
   */
  readonly keyMissing: boolean
}

/** The registration-side face the voice card's slot entry injects. */
export interface VoiceCardFace extends CardActions {
  hooks: {
    voiceCard: SnapshotStore<VoiceCardState>
  }
}

const MODES: readonly VoiceMode[] = ['off', 'openai']
const KEY_FIELD = 'apiKey'

function modeField(): CardFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' && value ? value : 'off'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'off'
      if (!(MODES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `voice` scope and OpenAI key credential onto the card. */
export class VoiceCardController {
  private readonly form: CardForm<VoiceSettings>
  private readonly store: SnapshotStore<VoiceCardState>
  private key: CredentialState = { configured: false, writable: true }

  constructor(
    scope: SettingsScope<VoiceSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [modeField(), textField('baseUrl')],
      [{ field: KEY_FIELD, write: (text) => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): VoiceCardState {
    const mode = this.form.field('mode')
    const modeValue = mode.text.trim() || 'off'
    return {
      ...this.form.shell(),
      mode,
      baseUrl: this.form.field('baseUrl'),
      apiKey: this.form.field(KEY_FIELD),
      apiKeyConfigured: this.key.configured,
      apiKeyWritable: this.key.writable,
      keyMissing: modeValue === 'openai' && !this.key.configured,
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

  inject(): VoiceCardFace {
    return { hooks: { voiceCard: this.store }, ...this.form.actions() }
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
