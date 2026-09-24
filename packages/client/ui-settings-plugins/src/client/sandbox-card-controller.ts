/** The sandbox card's staged form over the `sandbox` namespace. */

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
export const SANDBOX_NS = 'sandbox'

/** Backends the card may stage. */
export type SandboxBackend = 'workspace' | 'docker' | 'bwrap' | 'windows'

/** Docker network modes the card may stage. */
export type SandboxDockerNetwork = 'none' | 'bridge'

/** Windows modes the card may stage. */
export type SandboxWindowsMode =
  | 'workspace-write'
  | 'read-only'
  | 'danger-full-access'

/** Host-served sandbox section. */
export interface SandboxSettings {
  readonly backend?: SandboxBackend | string
  readonly dockerImage?: string
  readonly dockerNetwork?: SandboxDockerNetwork | string
  readonly windowsMode?: SandboxWindowsMode | string
}

/** What the sandbox card renders. */
export interface SandboxCardState extends CardShell {
  readonly backend: CardFieldState
  readonly dockerImage: CardFieldState
  readonly dockerNetwork: CardFieldState
  readonly windowsMode: CardFieldState
}

/** The registration-side face the sandbox card's slot entry injects. */
export interface SandboxCardFace extends CardActions {
  hooks: {
    sandboxCard: SnapshotStore<SandboxCardState>
  }
}

const BACKENDS: readonly SandboxBackend[] = [
  'workspace',
  'docker',
  'bwrap',
  'windows',
]

const DOCKER_NETWORKS: readonly SandboxDockerNetwork[] = ['none', 'bridge']

const WINDOWS_MODES: readonly SandboxWindowsMode[] = [
  'workspace-write',
  'read-only',
  'danger-full-access',
]

function enumField(
  field: string,
  allowed: readonly string[],
  fallback: string,
): CardFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'string' && value ? value : fallback),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || fallback
      if (!allowed.includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `sandbox` scope onto the card. */
export class SandboxCardController {
  private readonly form: CardForm<SandboxSettings>
  private readonly store: SnapshotStore<SandboxCardState>

  /** @param scope - the bound settings scope for the `sandbox` namespace. */
  constructor(scope: SettingsScope<SandboxSettings>) {
    this.form = new CardForm(scope, [
      enumField('backend', BACKENDS, 'workspace'),
      textField('dockerImage'),
      enumField('dockerNetwork', DOCKER_NETWORKS, 'none'),
      enumField('windowsMode', WINDOWS_MODES, 'workspace-write'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SandboxCardState {
    return {
      ...this.form.shell(),
      backend: this.form.field('backend'),
      dockerImage: this.form.field('dockerImage'),
      dockerNetwork: this.form.field('dockerNetwork'),
      windowsMode: this.form.field('windowsMode'),
    }
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): SandboxCardFace {
    return { hooks: { sandboxCard: this.store }, ...this.form.actions() }
  }
}
