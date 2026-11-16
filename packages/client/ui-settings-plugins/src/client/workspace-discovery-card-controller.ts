/** Staged form over Face `workspace-discovery` (workspace_list + peer/sibling scope). */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  booleanField,
  numberField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

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
  /** Prefer same-workspace hits when searching peers. */
  preferSameWorkspace?: boolean
  /** Boss-session peer discovery across sibling chats. */
  peerSessionDiscovery?: boolean
  /** Sibling child visibility: same-delegator | none. */
  siblingScope?: 'same-delegator' | 'none'
  /** Max discovery graph depth (1 = direct peers only). */
  maxDepth?: number
}

/** What the card renders. */
export interface WorkspaceDiscoveryCardState extends CardShell {
  activeWindowHours: CardFieldState
  maxActiveItems: CardFieldState
  maxListItems: CardFieldState
  preferSameWorkspace: CardFieldState
  peerSessionDiscovery: CardFieldState
  siblingScope: CardFieldState
  maxDepth: CardFieldState
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
      booleanField('preferSameWorkspace', true),
      booleanField('peerSessionDiscovery', true),
      textField('siblingScope'),
      numberField('maxDepth'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WorkspaceDiscoveryCardState {
    return {
      ...this.form.shell(),
      activeWindowHours: this.form.field('activeWindowHours'),
      maxActiveItems: this.form.field('maxActiveItems'),
      maxListItems: this.form.field('maxListItems'),
      preferSameWorkspace: this.form.field('preferSameWorkspace'),
      peerSessionDiscovery: this.form.field('peerSessionDiscovery'),
      siblingScope: this.form.field('siblingScope'),
      maxDepth: this.form.field('maxDepth'),
    }
  }

  inject(): WorkspaceDiscoveryCardFace {
    return { hooks: { workspaceDiscoveryCard: this.store }, ...this.form.actions() }
  }
}
