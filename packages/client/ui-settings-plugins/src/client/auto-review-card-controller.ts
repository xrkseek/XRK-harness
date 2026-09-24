/** Face `auto-review` card (Plugins → Advanced): classifier URL + Credentials token. */

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
export const AUTO_REVIEW_NS = 'auto-review'

/** Credential ref for the classifier Bearer token. */
export const AUTO_REVIEW_CLASSIFIER_TOKEN_REF = 'XRK_AUTO_REVIEW_CLASSIFIER_TOKEN'

/** Host-served auto-review section. */
export interface AutoReviewSettings {
  readonly classifierUrl?: string
}

interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** What the auto-review card renders. */
export interface AutoReviewCardState extends CardShell {
  readonly classifierUrl: CardFieldState
  readonly classifierToken: CardFieldState
  readonly tokenConfigured: boolean
  readonly tokenWritable: boolean
}

/** The registration-side face the auto-review card's slot entry injects. */
export interface AutoReviewCardFace extends CardActions {
  hooks: {
    autoReviewCard: SnapshotStore<AutoReviewCardState>
  }
}

const TOKEN_FIELD = 'classifierToken'

/** Bridges the `auto-review` scope and classifier token credential onto the card. */
export class AutoReviewCardController {
  private readonly form: CardForm<AutoReviewSettings>
  private readonly store: SnapshotStore<AutoReviewCardState>
  private key: CredentialState = { configured: false, writable: true }

  constructor(
    scope: SettingsScope<AutoReviewSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('classifierUrl')],
      [{ field: TOKEN_FIELD, write: (text) => this.writeToken(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): AutoReviewCardState {
    return {
      ...this.form.shell(),
      classifierUrl: this.form.field('classifierUrl'),
      classifierToken: this.form.field(TOKEN_FIELD),
      tokenConfigured: this.key.configured,
      tokenWritable: this.key.writable,
    }
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [AUTO_REVIEW_CLASSIFIER_TOKEN_REF],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const row = response.result.value.credentials[AUTO_REVIEW_CLASSIFIER_TOKEN_REF]
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
    if (ref !== AUTO_REVIEW_CLASSIFIER_TOKEN_REF) return
    void this.readCredential()
  }

  inject(): AutoReviewCardFace {
    return { hooks: { autoReviewCard: this.store }, ...this.form.actions() }
  }

  private async writeToken(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({
        ref: AUTO_REVIEW_CLASSIFIER_TOKEN_REF,
        value,
      })
      await this.readCredential()
      return true
    } catch {
      return false
    }
  }
}
