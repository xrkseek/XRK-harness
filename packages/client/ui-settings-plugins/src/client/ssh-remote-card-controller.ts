/** Face `ssh-remote` card staged over the General Settings surface. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  numberField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const SSH_REMOTE_NS = 'ssh-remote'

/** Host-served ssh-remote section. */
export interface SshRemoteSettings {
  readonly host?: string
  readonly workspace?: string
  readonly user?: string
  readonly port?: number
  readonly keyPath?: string
}

/** What the remote card renders. */
export interface SshRemoteCardState extends CardShell {
  readonly host: CardFieldState
  readonly workspace: CardFieldState
  readonly user: CardFieldState
  readonly port: CardFieldState
  readonly keyPath: CardFieldState
}

/** The registration-side face the remote card's slot entry injects. */
export interface SshRemoteCardFace extends CardActions {
  hooks: {
    sshRemoteCard: SnapshotStore<SshRemoteCardState>
  }
}

/** Bridges the `ssh-remote` scope onto the General card. */
export class SshRemoteCardController {
  private readonly form: CardForm<SshRemoteSettings>
  private readonly store: SnapshotStore<SshRemoteCardState>

  /** @param scope - the bound settings scope for the `ssh-remote` namespace. */
  constructor(scope: SettingsScope<SshRemoteSettings>) {
    this.form = new CardForm(scope, [
      textField('host'),
      textField('workspace'),
      textField('user'),
      numberField('port'),
      textField('keyPath'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SshRemoteCardState {
    return {
      ...this.form.shell(),
      host: this.form.field('host'),
      workspace: this.form.field('workspace'),
      user: this.form.field('user'),
      port: this.form.field('port'),
      keyPath: this.form.field('keyPath'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): SshRemoteCardFace {
    return { hooks: { sshRemoteCard: this.store }, ...this.form.actions() }
  }
}
