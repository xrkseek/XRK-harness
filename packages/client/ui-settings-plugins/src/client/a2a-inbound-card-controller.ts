/** Face `a2a-inbound` card: Agent Card + message/send → Face session inject. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  numberField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const A2A_INBOUND_NS = 'a2a-inbound'

/** Host-served a2a-inbound section. */
export interface A2aInboundSettings {
  readonly enabled?: boolean
  readonly sessionId?: string
  readonly timeoutMs?: number
}

/** What the a2a-inbound card renders. */
export interface A2aInboundCardState extends CardShell {
  readonly enabled: CardFieldState
  readonly sessionId: CardFieldState
  readonly timeoutMs: CardFieldState
}

/** The registration-side face the a2a-inbound card's slot entry injects. */
export interface A2aInboundCardFace extends CardActions {
  hooks: {
    a2aInboundCard: SnapshotStore<A2aInboundCardState>
  }
}

function enabledField(): CardFieldSpec {
  return {
    field: 'enabled',
    format: (value) => (value === true ? 'true' : 'false'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'false'
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** Bridges the `a2a-inbound` scope onto the card. */
export class A2aInboundCardController {
  private readonly form: CardForm<A2aInboundSettings>
  private readonly store: SnapshotStore<A2aInboundCardState>

  /** @param scope - the bound settings scope for the `a2a-inbound` namespace. */
  constructor(scope: SettingsScope<A2aInboundSettings>) {
    this.form = new CardForm(scope, [
      enabledField(),
      textField('sessionId'),
      numberField('timeoutMs'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): A2aInboundCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      sessionId: this.form.field('sessionId'),
      timeoutMs: this.form.field('timeoutMs'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): A2aInboundCardFace {
    return { hooks: { a2aInboundCard: this.store }, ...this.form.actions() }
  }
}
