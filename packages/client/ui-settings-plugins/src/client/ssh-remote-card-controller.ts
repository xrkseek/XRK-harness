/** Face `ssh-remote` card staged over the General Settings surface. */

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

/**
 * Workspace must be absolute POSIX (`/…`) when either host or workspace is set.
 * Empty+empty stays local (valid). Windows drive letters are rejected early.
 */
function workspaceField(): CardFieldSpec {
  const base = textField('workspace')
  return {
    field: 'workspace',
    format: base.format,
    parse: (text): FieldWrite | undefined => {
      const write = base.parse(text)
      if (write === undefined) return undefined
      if (write.kind === 'clear') return write
      const workspace = String(write.value ?? '').trim()
      if (workspace === '') return { kind: 'clear' }
      if (!workspace.startsWith('/')) return undefined
      return { kind: 'set', value: workspace }
    },
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
      workspaceField(),
      textField('user'),
      numberField('port'),
      textField('keyPath'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SshRemoteCardState {
    const shell = this.form.shell()
    const host = this.form.field('host')
    const workspace = this.form.field('workspace')
    // Pairing: host without workspace (or the reverse) must not save.
    const hostText = host.text.trim()
    const wsText = workspace.text.trim()
    const pairBroken =
      (hostText !== '' && wsText === '') || (hostText === '' && wsText !== '')
    return {
      ...shell,
      host,
      workspace: pairBroken
        ? { ...workspace, invalid: true }
        : workspace,
      user: this.form.field('user'),
      port: this.form.field('port'),
      keyPath: this.form.field('keyPath'),
      invalid: shell.invalid || pairBroken,
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): SshRemoteCardFace {
    return { hooks: { sshRemoteCard: this.store }, ...this.form.actions() }
  }
}
