/** Face `sunflower-free` egress card (OpenCode / Kilo proxy cascade). */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const SUNFLOWER_FREE_NS = 'sunflower-free'

/** Host-served sunflower-free section. */
export interface SunflowerFreeSettings {
  readonly openCodeProxy?: string
  readonly kiloProxy?: string
}

/** What the sunflower-free card renders. */
export interface SunflowerFreeCardState extends CardShell {
  readonly openCodeProxy: CardFieldState
  readonly kiloProxy: CardFieldState
}

/** The registration-side face the sunflower-free card's slot entry injects. */
export interface SunflowerFreeCardFace extends CardActions {
  hooks: {
    sunflowerFreeCard: SnapshotStore<SunflowerFreeCardState>
  }
}

/** Bridges the `sunflower-free` scope onto the Plugins card. */
export class SunflowerFreeCardController {
  private readonly form: CardForm<SunflowerFreeSettings>
  private readonly store: SnapshotStore<SunflowerFreeCardState>

  /** @param scope - the bound settings scope for the `sunflower-free` namespace. */
  constructor(scope: SettingsScope<SunflowerFreeSettings>) {
    this.form = new CardForm(scope, [
      textField('openCodeProxy'),
      textField('kiloProxy'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SunflowerFreeCardState {
    return {
      ...this.form.shell(),
      openCodeProxy: this.form.field('openCodeProxy'),
      kiloProxy: this.form.field('kiloProxy'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): SunflowerFreeCardFace {
    return { hooks: { sunflowerFreeCard: this.store }, ...this.form.actions() }
  }
}
