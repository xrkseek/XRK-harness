/** The cron card's staged form over the `cron` namespace. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const CRON_NS = 'cron'

/** Host-served cron section. */
export interface CronSettings {
  readonly enabled?: boolean
}

/** What the cron card renders. */
export interface CronCardState extends CardShell {
  readonly enabled: CardFieldState
}

/** The registration-side face the cron card's slot entry injects. */
export interface CronCardFace extends CardActions {
  hooks: {
    cronCard: SnapshotStore<CronCardState>
  }
}

function enabledField(): CardFieldSpec {
  return {
    field: 'enabled',
    format: (value) => (value === false ? 'false' : 'true'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'true'
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** Bridges the `cron` scope onto the card. */
export class CronCardController {
  private readonly form: CardForm<CronSettings>
  private readonly store: SnapshotStore<CronCardState>

  /** @param scope - the bound settings scope for the `cron` namespace. */
  constructor(scope: SettingsScope<CronSettings>) {
    this.form = new CardForm(scope, [enabledField()])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): CronCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): CronCardFace {
    return { hooks: { cronCard: this.store }, ...this.form.actions() }
  }
}
