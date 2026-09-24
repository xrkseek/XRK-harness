/** The curated-memory card's staged form over the `curated-memory` namespace. */

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
export const CURATED_MEMORY_NS = 'curated-memory'

/** Host-served curated-memory section. */
export interface CuratedMemorySettings {
  readonly enabled?: boolean
}

/** What the curated-memory card renders. */
export interface CuratedMemoryCardState extends CardShell {
  readonly enabled: CardFieldState
}

/** The registration-side face the curated-memory card's slot entry injects. */
export interface CuratedMemoryCardFace extends CardActions {
  hooks: {
    curatedMemoryCard: SnapshotStore<CuratedMemoryCardState>
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

/** Bridges the `curated-memory` scope onto the card. */
export class CuratedMemoryCardController {
  private readonly form: CardForm<CuratedMemorySettings>
  private readonly store: SnapshotStore<CuratedMemoryCardState>

  /** @param scope - the bound settings scope for the `curated-memory` namespace. */
  constructor(scope: SettingsScope<CuratedMemorySettings>) {
    this.form = new CardForm(scope, [enabledField()])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): CuratedMemoryCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): CuratedMemoryCardFace {
    return { hooks: { curatedMemoryCard: this.store }, ...this.form.actions() }
  }
}
