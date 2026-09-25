/** The video-analyze card's staged form over the `video-analyze` namespace. */

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
export const VIDEO_ANALYZE_NS = 'video-analyze'

/** Credential ref for the OpenAI-compatible API key. */
export const VIDEO_ANALYZE_OPENAI_REF = 'XRK_VIDEO_ANALYZE_OPENAI_KEY'

export type VideoAnalyzeMode = 'off' | 'openai'

export interface VideoAnalyzeSettings {
  readonly mode?: VideoAnalyzeMode | string
  readonly baseUrl?: string
  readonly model?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

export interface VideoAnalyzeCardState extends CardShell {
  readonly mode: CardFieldState
  readonly baseUrl: CardFieldState
  readonly model: CardFieldState
  readonly apiKey: CardFieldState
  readonly apiKeyConfigured: boolean
  readonly apiKeyWritable: boolean
}

export interface VideoAnalyzeCardFace extends CardActions {
  hooks: {
    videoAnalyzeCard: SnapshotStore<VideoAnalyzeCardState>
  }
}

const MODES: readonly VideoAnalyzeMode[] = ['off', 'openai']
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

/** Bridges the `video-analyze` scope and OpenAI key credential onto the card. */
export class VideoAnalyzeCardController {
  private readonly form: CardForm<VideoAnalyzeSettings>
  private readonly store: SnapshotStore<VideoAnalyzeCardState>
  private key: CredentialState = { configured: false, writable: true }

  constructor(
    scope: SettingsScope<VideoAnalyzeSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [modeField(), textField('baseUrl'), textField('model')],
      [{ field: KEY_FIELD, write: (text) => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): VideoAnalyzeCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      baseUrl: this.form.field('baseUrl'),
      model: this.form.field('model'),
      apiKey: this.form.field(KEY_FIELD),
      apiKeyConfigured: this.key.configured,
      apiKeyWritable: this.key.writable,
    }
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [VIDEO_ANALYZE_OPENAI_REF],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const row = response.result.value.credentials[VIDEO_ANALYZE_OPENAI_REF]
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
    if (ref !== VIDEO_ANALYZE_OPENAI_REF) return
    void this.readCredential()
  }

  inject(): VideoAnalyzeCardFace {
    return { hooks: { videoAnalyzeCard: this.store }, ...this.form.actions() }
  }

  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: VIDEO_ANALYZE_OPENAI_REF, value })
      await this.readCredential()
      return true
    } catch {
      return false
    }
  }
}
