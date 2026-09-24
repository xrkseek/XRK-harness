/** Face `memory-embed` card (Plugins → Advanced): vector sidecar URL + collection + Credentials token. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const MEMORY_EMBED_NS = 'memory-embed'

/** Credential ref for the sidecar Bearer token. */
export const MEMORY_EMBED_TOKEN_REF = 'XRK_MEMORY_EMBED_TOKEN'

/** Host-served memory-embed section. */
export interface MemoryEmbedSettings {
  readonly url?: string
  readonly collection?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** What the memory-embed card renders. */
export interface MemoryEmbedCardState extends CardShell {
  readonly url: CardFieldState
  readonly collection: CardFieldState
  readonly token: CardFieldState
  readonly tokenConfigured: boolean
  readonly tokenWritable: boolean
}

/** The registration-side face the memory-embed card's slot entry injects. */
export interface MemoryEmbedCardFace extends CardActions {
  hooks: {
    memoryEmbedCard: SnapshotStore<MemoryEmbedCardState>
  }
}

const TOKEN_FIELD = 'token'

/** Bridges the `memory-embed` scope and sidecar token credential onto the card. */
export class MemoryEmbedCardController {
  private readonly form: CardForm<MemoryEmbedSettings>
  private readonly store: SnapshotStore<MemoryEmbedCardState>
  private key: CredentialState = { configured: false, writable: true }

  constructor(
    scope: SettingsScope<MemoryEmbedSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('url'), textField('collection')],
      [{ field: TOKEN_FIELD, write: (text) => this.writeToken(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): MemoryEmbedCardState {
    return {
      ...this.form.shell(),
      url: this.form.field('url'),
      collection: this.form.field('collection'),
      token: this.form.field(TOKEN_FIELD),
      tokenConfigured: this.key.configured,
      tokenWritable: this.key.writable,
    }
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [MEMORY_EMBED_TOKEN_REF],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const row = response.result.value.credentials[MEMORY_EMBED_TOKEN_REF]
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
    if (ref !== MEMORY_EMBED_TOKEN_REF) return
    void this.readCredential()
  }

  inject(): MemoryEmbedCardFace {
    return { hooks: { memoryEmbedCard: this.store }, ...this.form.actions() }
  }

  private async writeToken(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({
        ref: MEMORY_EMBED_TOKEN_REF,
        value,
      })
      await this.readCredential()
      return true
    } catch {
      return false
    }
  }
}
