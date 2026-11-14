/** Staged form over Face `workspace-discovery` (workspace_list active window). */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import { CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/** Must match Face `FACE_PRODUCT_SETTINGS_NAMESPACES` (`workspace-discovery`). */
export const WORKSPACE_DISCOVERY_NS = 'workspace-discovery'

/** Fields this card edits. */
export interface WorkspaceDiscoverySettings {
  /** Hours since last activity → still listed as active. */
  activeWindowHours?: number
  /** Cap when includeInactive is off. */
  maxActiveItems?: number
  /** Hard cap when listing dormant / query hits. */
  maxListItems?: number
}

/** What the card renders. */
export interface WorkspaceDiscoveryCardState extends CardShell {
  activeWindowHours: CardFieldState
  maxActiveItems: CardFieldState
  maxListItems: CardFieldState
}

/** Slot face for the card. */
export interface WorkspaceDiscoveryCardFace extends CardActions {
  hooks: {
    workspaceDiscoveryCard: SnapshotStore<WorkspaceDiscoveryCardState>
  }
}

/** Bridges the settings scope onto the staged form. */
export class WorkspaceDiscoveryCardController {
  private readonly form: CardForm<WorkspaceDiscoverySettings>
  private readonly store: SnapshotStore<WorkspaceDiscoveryCardState>

  constructor(scope: SettingsScope<WorkspaceDiscoverySettings>) {
    this.form = new CardForm(scope, [
      numberField('activeWindowHours'),
      numberField('maxActiveItems'),
      numberField('maxListItems'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WorkspaceDiscoveryCardState {
    return {
      ...this.form.shell(),
      activeWindowHours: this.form.field('activeWindowHours'),
      maxActiveItems: this.form.field('maxActiveItems'),
      maxListItems: this.form.field('maxListItems'),
    }
  }

  inject(): WorkspaceDiscoveryCardFace {
    return { hooks: { workspaceDiscoveryCard: this.store }, ...this.form.actions() }
  }
}
