/** The browser card's staged form over the `browser` namespace. */

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
export const BROWSER_NS = 'browser'

/** Modes the card may stage. */
export type BrowserMode = 'http' | 'cdp'

/** Host-served browser section. */
export interface BrowserSettings {
  readonly mode?: BrowserMode | string
  readonly cdpUrl?: string
}

/** What the browser card renders. */
export interface BrowserCardState extends CardShell {
  readonly mode: CardFieldState
  readonly cdpUrl: CardFieldState
}

/** The registration-side face the browser card's slot entry injects. */
export interface BrowserCardFace extends CardActions {
  hooks: {
    browserCard: SnapshotStore<BrowserCardState>
  }
}

const MODES: readonly BrowserMode[] = ['http', 'cdp']

function modeField(): CardFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' && value ? value : 'http'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'http'
      if (!(MODES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `browser` scope onto the card. */
export class BrowserCardController {
  private readonly form: CardForm<BrowserSettings>
  private readonly store: SnapshotStore<BrowserCardState>

  /** @param scope - the bound settings scope for the `browser` namespace. */
  constructor(scope: SettingsScope<BrowserSettings>) {
    this.form = new CardForm(scope, [modeField(), textField('cdpUrl')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): BrowserCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      cdpUrl: this.form.field('cdpUrl'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): BrowserCardFace {
    return { hooks: { browserCard: this.store }, ...this.form.actions() }
  }
}
