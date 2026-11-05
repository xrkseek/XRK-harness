/** The browser card's staged form over the `browser` namespace. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  booleanField,
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
export type BrowserMode = 'agent-browser' | 'http' | 'cdp'

/** Binary preference when executable path is empty. */
export type BrowserBinary = 'auto' | 'edge' | 'chrome' | 'bundled'

/** Host-served browser section. */
export interface BrowserSettings {
  readonly mode?: BrowserMode | string
  readonly cdpUrl?: string
  readonly headed?: boolean
  readonly browserBinary?: BrowserBinary | string
  readonly executablePath?: string
  readonly chromeArgs?: string
  readonly profile?: string
  readonly proxy?: string
  readonly restore?: boolean
  readonly autoConnect?: boolean
  readonly statePath?: string
}

/** What the browser card renders. */
export interface BrowserCardState extends CardShell {
  readonly mode: CardFieldState
  readonly cdpUrl: CardFieldState
  readonly headed: CardFieldState
  readonly browserBinary: CardFieldState
  readonly executablePath: CardFieldState
  readonly chromeArgs: CardFieldState
  readonly profile: CardFieldState
  readonly proxy: CardFieldState
  readonly restore: CardFieldState
  readonly autoConnect: CardFieldState
  readonly statePath: CardFieldState
}

/** The registration-side face the browser card's slot entry injects. */
export interface BrowserCardFace extends CardActions {
  hooks: {
    browserCard: SnapshotStore<BrowserCardState>
  }
}

const MODES: readonly BrowserMode[] = ['agent-browser', 'http', 'cdp']
const BINARIES: readonly BrowserBinary[] = ['auto', 'edge', 'chrome', 'bundled']

function modeField(): CardFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' && value ? value : 'agent-browser'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'agent-browser'
      if (!(MODES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

function browserBinaryField(): CardFieldSpec {
  return {
    field: 'browserBinary',
    format: (value) => (typeof value === 'string' && value ? value : 'auto'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'auto'
      if (!(BINARIES as readonly string[]).includes(trimmed)) return undefined
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
    this.form = new CardForm(scope, [
      modeField(),
      textField('cdpUrl'),
      // Match Face schema defaults so a missing row still shows On / On / Off.
      booleanField('headed', true),
      browserBinaryField(),
      textField('executablePath'),
      textField('chromeArgs'),
      textField('profile'),
      textField('proxy'),
      booleanField('restore', true),
      booleanField('autoConnect', false),
      textField('statePath'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): BrowserCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      cdpUrl: this.form.field('cdpUrl'),
      headed: this.form.field('headed'),
      browserBinary: this.form.field('browserBinary'),
      executablePath: this.form.field('executablePath'),
      chromeArgs: this.form.field('chromeArgs'),
      profile: this.form.field('profile'),
      proxy: this.form.field('proxy'),
      restore: this.form.field('restore'),
      autoConnect: this.form.field('autoConnect'),
      statePath: this.form.field('statePath'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): BrowserCardFace {
    return { hooks: { browserCard: this.store }, ...this.form.actions() }
  }
}
