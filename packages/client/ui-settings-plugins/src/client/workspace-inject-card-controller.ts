/** The workspace-inject card's staged form over the `workspace-inject` namespace. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import { CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the durable rules/skills inject budget. Must match Face
 * `FACE_PRODUCT_SETTINGS_NAMESPACES` (`workspace-inject`).
 */
export const WORKSPACE_INJECT_NS = 'workspace-inject'

/** The inject fields this card edits. */
export interface WorkspaceInjectSettings {
  /** Total character budget for rules + skills catalog inject (per turn). */
  injectMaxChars?: number
}

/** What the workspace-inject card renders. */
export interface WorkspaceInjectCardState extends CardShell {
  /** Character budget for inject. */
  injectMaxChars: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface WorkspaceInjectCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWorkspaceInjectCard. */
    workspaceInjectCard: SnapshotStore<WorkspaceInjectCardState>
  }
}

/** Bridges the `workspace-inject` scope onto the card's staged form. */
export class WorkspaceInjectCardController {
  private readonly form: CardForm<WorkspaceInjectSettings>
  private readonly store: SnapshotStore<WorkspaceInjectCardState>

  /** @param scope - the bound settings scope for the `workspace-inject` namespace. */
  constructor(scope: SettingsScope<WorkspaceInjectSettings>) {
    this.form = new CardForm(scope, [numberField('injectMaxChars')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WorkspaceInjectCardState {
    return {
      ...this.form.shell(),
      injectMaxChars: this.form.field('injectMaxChars'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WorkspaceInjectCardFace {
    return { hooks: { workspaceInjectCard: this.store }, ...this.form.actions() }
  }
}
