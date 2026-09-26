/** The image-gen card's staged form over the `image-gen` namespace. */

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
export const IMAGE_GEN_NS = 'image-gen'

/** Credential refs (envVar of each slot). */
export const IMAGE_GEN_OPENAI_REF = 'XRK_IMAGE_GEN_OPENAI_KEY'
export const IMAGE_GEN_FAL_REF = 'XRK_IMAGE_GEN_FAL_KEY'
export const IMAGE_GEN_XAI_REF = 'XRK_IMAGE_GEN_XAI_KEY'
export const IMAGE_GEN_OPENROUTER_REF = 'XRK_IMAGE_GEN_OPENROUTER_KEY'
export const IMAGE_GEN_DEEPINFRA_REF = 'XRK_IMAGE_GEN_DEEPINFRA_KEY'
export const IMAGE_GEN_KREA_REF = 'XRK_IMAGE_GEN_KREA_KEY'
export const IMAGE_GEN_META_REF = 'XRK_IMAGE_GEN_META_KEY'

export type ImageGenMode =
  | 'off'
  | 'openai'
  | 'fal'
  | 'xai'
  | 'openrouter'
  | 'deepinfra'
  | 'krea'
  | 'meta-ai'

export interface ImageGenSettings {
  readonly mode?: ImageGenMode | string
  readonly baseUrl?: string
  readonly model?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

export interface ImageGenCardState extends CardShell {
  readonly mode: CardFieldState
  readonly baseUrl: CardFieldState
  readonly model: CardFieldState
  readonly openaiApiKey: CardFieldState
  readonly falApiKey: CardFieldState
  readonly xaiApiKey: CardFieldState
  readonly openrouterApiKey: CardFieldState
  readonly deepinfraApiKey: CardFieldState
  readonly kreaApiKey: CardFieldState
  readonly metaApiKey: CardFieldState
  readonly openaiConfigured: boolean
  readonly openaiWritable: boolean
  readonly falConfigured: boolean
  readonly falWritable: boolean
  readonly xaiConfigured: boolean
  readonly xaiWritable: boolean
  readonly openrouterConfigured: boolean
  readonly openrouterWritable: boolean
  readonly deepinfraConfigured: boolean
  readonly deepinfraWritable: boolean
  readonly kreaConfigured: boolean
  readonly kreaWritable: boolean
  readonly metaConfigured: boolean
  readonly metaWritable: boolean
}

export interface ImageGenCardFace extends CardActions {
  hooks: {
    imageGenCard: SnapshotStore<ImageGenCardState>
  }
}

const MODES: readonly ImageGenMode[] = [
  'off',
  'openai',
  'fal',
  'xai',
  'openrouter',
  'deepinfra',
  'krea',
  'meta-ai',
]
const OPENAI_FIELD = 'openaiApiKey'
const FAL_FIELD = 'falApiKey'
const XAI_FIELD = 'xaiApiKey'
const OPENROUTER_FIELD = 'openrouterApiKey'
const DEEPINFRA_FIELD = 'deepinfraApiKey'
const KREA_FIELD = 'kreaApiKey'
const META_FIELD = 'metaApiKey'

const ALL_REFS = [
  IMAGE_GEN_OPENAI_REF,
  IMAGE_GEN_FAL_REF,
  IMAGE_GEN_XAI_REF,
  IMAGE_GEN_OPENROUTER_REF,
  IMAGE_GEN_DEEPINFRA_REF,
  IMAGE_GEN_KREA_REF,
  IMAGE_GEN_META_REF,
] as const

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

function emptyCred(): CredentialState {
  return { configured: false, writable: true }
}

/** Bridges the `image-gen` scope and provider keys onto the card. */
export class ImageGenCardController {
  private readonly form: CardForm<ImageGenSettings>
  private readonly store: SnapshotStore<ImageGenCardState>
  private openai: CredentialState = emptyCred()
  private fal: CredentialState = emptyCred()
  private xai: CredentialState = emptyCred()
  private openrouter: CredentialState = emptyCred()
  private deepinfra: CredentialState = emptyCred()
  private krea: CredentialState = emptyCred()
  private meta: CredentialState = emptyCred()

  constructor(
    scope: SettingsScope<ImageGenSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [modeField(), textField('baseUrl'), textField('model')],
      [
        { field: OPENAI_FIELD, write: (text) => this.writeKey(IMAGE_GEN_OPENAI_REF, text) },
        { field: FAL_FIELD, write: (text) => this.writeKey(IMAGE_GEN_FAL_REF, text) },
        { field: XAI_FIELD, write: (text) => this.writeKey(IMAGE_GEN_XAI_REF, text) },
        { field: OPENROUTER_FIELD, write: (text) => this.writeKey(IMAGE_GEN_OPENROUTER_REF, text) },
        { field: DEEPINFRA_FIELD, write: (text) => this.writeKey(IMAGE_GEN_DEEPINFRA_REF, text) },
        { field: KREA_FIELD, write: (text) => this.writeKey(IMAGE_GEN_KREA_REF, text) },
        { field: META_FIELD, write: (text) => this.writeKey(IMAGE_GEN_META_REF, text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredentials()
  }

  private projection(): ImageGenCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      baseUrl: this.form.field('baseUrl'),
      model: this.form.field('model'),
      openaiApiKey: this.form.field(OPENAI_FIELD),
      falApiKey: this.form.field(FAL_FIELD),
      xaiApiKey: this.form.field(XAI_FIELD),
      openrouterApiKey: this.form.field(OPENROUTER_FIELD),
      deepinfraApiKey: this.form.field(DEEPINFRA_FIELD),
      kreaApiKey: this.form.field(KREA_FIELD),
      metaApiKey: this.form.field(META_FIELD),
      openaiConfigured: this.openai.configured,
      openaiWritable: this.openai.writable,
      falConfigured: this.fal.configured,
      falWritable: this.fal.writable,
      xaiConfigured: this.xai.configured,
      xaiWritable: this.xai.writable,
      openrouterConfigured: this.openrouter.configured,
      openrouterWritable: this.openrouter.writable,
      deepinfraConfigured: this.deepinfra.configured,
      deepinfraWritable: this.deepinfra.writable,
      kreaConfigured: this.krea.configured,
      kreaWritable: this.krea.writable,
      metaConfigured: this.meta.configured,
      metaWritable: this.meta.writable,
    }
  }

  private async readCredentials(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [...ALL_REFS],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const creds = response.result.value.credentials
    const pick = (ref: string): CredentialState => ({
      configured: creds[ref]?.configured ?? false,
      writable: creds[ref]?.writable ?? true,
    })
    const next = {
      openai: pick(IMAGE_GEN_OPENAI_REF),
      fal: pick(IMAGE_GEN_FAL_REF),
      xai: pick(IMAGE_GEN_XAI_REF),
      openrouter: pick(IMAGE_GEN_OPENROUTER_REF),
      deepinfra: pick(IMAGE_GEN_DEEPINFRA_REF),
      krea: pick(IMAGE_GEN_KREA_REF),
      meta: pick(IMAGE_GEN_META_REF),
    }
    const same =
      next.openai.configured === this.openai.configured
      && next.openai.writable === this.openai.writable
      && next.fal.configured === this.fal.configured
      && next.fal.writable === this.fal.writable
      && next.xai.configured === this.xai.configured
      && next.xai.writable === this.xai.writable
      && next.openrouter.configured === this.openrouter.configured
      && next.openrouter.writable === this.openrouter.writable
      && next.deepinfra.configured === this.deepinfra.configured
      && next.deepinfra.writable === this.deepinfra.writable
      && next.krea.configured === this.krea.configured
      && next.krea.writable === this.krea.writable
      && next.meta.configured === this.meta.configured
      && next.meta.writable === this.meta.writable
    if (same) return
    Object.assign(this, next)
    this.store.set(this.projection())
  }

  refreshCredential(ref: string): void {
    if (!(ALL_REFS as readonly string[]).includes(ref)) return
    void this.readCredentials()
  }

  inject(): ImageGenCardFace {
    return { hooks: { imageGenCard: this.store }, ...this.form.actions() }
  }

  private async writeKey(ref: string, value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref, value })
      await this.readCredentials()
      return true
    } catch {
      return false
    }
  }
}
