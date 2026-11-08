/** Face `git-attribution` — on/off only (fixed xrkseek Co-authored-by). */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  booleanField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const GIT_ATTRIBUTION_NS = 'git-attribution'

export interface GitAttributionSettings {
  readonly enabled?: boolean
}

export interface GitAttributionCardState extends CardShell {
  readonly enabled: CardFieldState
}

export interface GitAttributionCardFace extends CardActions {
  hooks: {
    gitAttributionCard: SnapshotStore<GitAttributionCardState>
  }
  commit: (field: 'enabled', value: string) => void
}

/** Bridges the `git-attribution` scope onto the General card. */
export class GitAttributionCardController {
  private readonly form: CardForm<GitAttributionSettings>
  private readonly store: SnapshotStore<GitAttributionCardState>
  private readonly scope: SettingsScope<GitAttributionSettings>
  private commitGeneration = 0

  constructor(scope: SettingsScope<GitAttributionSettings>) {
    this.scope = scope
    this.form = new CardForm(scope, [booleanField('enabled', true)])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): GitAttributionCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  private commitEnabled(text: string): void {
    const value = text === 'true' ? true : text === 'false' ? false : undefined
    if (value === undefined) return
    this.form.actions().edit('enabled', text)
    const generation = ++this.commitGeneration
    void this.scope.set('enabled', value).catch(() => {
      if (generation !== this.commitGeneration) return
    })
  }

  inject(): GitAttributionCardFace {
    const actions = this.form.actions()
    return {
      hooks: { gitAttributionCard: this.store },
      ...actions,
      commit: (_field, value) => {
        this.commitEnabled(value)
      },
    }
  }
}
