/** The session-telemetry card's staged form over the `session-telemetry` namespace. */

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
export const SESSION_TELEMETRY_NS = 'session-telemetry'

/** Modes the card may stage. */
export type SessionTelemetryMode = 'off' | 'memory' | 'otlp'

/** Host-served session-telemetry section. */
export interface SessionTelemetrySettings {
  readonly mode?: SessionTelemetryMode | string
  readonly endpoint?: string
}

/** What the telemetry card renders. */
export interface TelemetryCardState extends CardShell {
  readonly mode: CardFieldState
  readonly endpoint: CardFieldState
}

/** The registration-side face the telemetry card's slot entry injects. */
export interface TelemetryCardFace extends CardActions {
  hooks: {
    telemetryCard: SnapshotStore<TelemetryCardState>
  }
}

const MODES: readonly SessionTelemetryMode[] = ['off', 'memory', 'otlp']

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

/** Bridges the `session-telemetry` scope onto the card. */
export class TelemetryCardController {
  private readonly form: CardForm<SessionTelemetrySettings>
  private readonly store: SnapshotStore<TelemetryCardState>

  /** @param scope - the bound settings scope for the `session-telemetry` namespace. */
  constructor(scope: SettingsScope<SessionTelemetrySettings>) {
    this.form = new CardForm(scope, [modeField(), textField('endpoint')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TelemetryCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      endpoint: this.form.field('endpoint'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): TelemetryCardFace {
    return { hooks: { telemetryCard: this.store }, ...this.form.actions() }
  }
}
