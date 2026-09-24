/** Face `external-agent` card: ACP / app-server / Claude Code spawn commands. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const EXTERNAL_AGENT_NS = 'external-agent'

/** Host-served external-agent section. */
export interface ExternalAgentSettings {
  readonly acpAgent?: string
  readonly codexAppServer?: string
  readonly claudeCode?: string
}

/** What the external-agent card renders. */
export interface ExternalAgentCardState extends CardShell {
  readonly acpAgent: CardFieldState
  readonly codexAppServer: CardFieldState
  readonly claudeCode: CardFieldState
}

/** The registration-side face the external-agent card's slot entry injects. */
export interface ExternalAgentCardFace extends CardActions {
  hooks: {
    externalAgentCard: SnapshotStore<ExternalAgentCardState>
  }
}

/** Bridges the `external-agent` scope onto the card. */
export class ExternalAgentCardController {
  private readonly form: CardForm<ExternalAgentSettings>
  private readonly store: SnapshotStore<ExternalAgentCardState>

  constructor(scope: SettingsScope<ExternalAgentSettings>) {
    this.form = new CardForm(scope, [
      textField('acpAgent'),
      textField('codexAppServer'),
      textField('claudeCode'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ExternalAgentCardState {
    return {
      ...this.form.shell(),
      acpAgent: this.form.field('acpAgent'),
      codexAppServer: this.form.field('codexAppServer'),
      claudeCode: this.form.field('claudeCode'),
    }
  }

  inject(): ExternalAgentCardFace {
    return { hooks: { externalAgentCard: this.store }, ...this.form.actions() }
  }
}
