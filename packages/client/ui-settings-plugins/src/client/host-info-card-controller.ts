/**
 * Read-only Host runtime card (Face `host`).
 *
 * The namespace is a Host mirror, not a user-editable section: the Host
 * publishes what it is (`hostPublic`) so a browser can see which Host it is
 * talking to, and Face describes it with an empty-object schema because none
 * of it is writable. The scope therefore binds a decoder — the default
 * schema-validation path a write card relies on only accepts sections the
 * schema described field by field.
 */

import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@xrkseek/client-runtime/client'
import { ABSENT, asSection, joinList, type InfoRow } from './info-card-model.ts'

/** Face namespace of the Host public snapshot. */
export const HOST_NS = 'host'

/** The Host public snapshot as the card reads it. */
export interface HostInfoSection {
  readonly host?: string
  readonly port?: number
  readonly workspaceRoot?: string
  readonly preset?: string
  readonly corsOrigin?: string
  readonly rateLimitPerMinute?: number
  readonly pluginsDir?: string
  readonly webDistConfigured?: boolean
  readonly cordisHostApplied?: readonly string[]
  readonly workflowEngine?: { readonly provider?: string }
}

/** What the Host card renders. */
export interface HostInfoCardState {
  /** `false` hides the card entirely; the namespace is not served. */
  readonly available: boolean
  readonly rows: readonly InfoRow[]
}

/** The registration-side face the Host card's slot entry injects. */
export interface HostInfoCardFace {
  hooks: {
    hostInfoCard: SnapshotStore<HostInfoCardState>
  }
}

/** Build the card's rows from one scope snapshot. */
function project(snapshot: SettingsScopeSnapshot<HostInfoSection>): HostInfoCardState {
  const value = snapshot.status === 'ready' ? snapshot.value : undefined
  if (value === undefined) return { available: false, rows: [] }
  const address = value.host === undefined
    ? ABSENT
    : value.port === undefined ? value.host : `${value.host}:${String(value.port)}`
  return {
    available: true,
    rows: [
      { label: 'hostAddress', value: address },
      { label: 'hostWorkspaceRoot', value: value.workspaceRoot ?? ABSENT },
      { label: 'hostPreset', value: value.preset ?? ABSENT },
      { label: 'hostCorsOrigin', value: value.corsOrigin ?? ABSENT },
      {
        label: 'hostRateLimit',
        value: value.rateLimitPerMinute === undefined ? ABSENT : String(value.rateLimitPerMinute),
      },
      { label: 'hostPluginsDir', value: value.pluginsDir ?? ABSENT },
      {
        label: 'hostWebDist',
        value: '',
        valueKey: value.webDistConfigured === true ? 'hostWebDistBuilt' : 'hostWebDistNone',
      },
      { label: 'hostApplied', value: joinList(value.cordisHostApplied) },
      { label: 'hostWorkflowEngine', value: value.workflowEngine?.provider ?? ABSENT },
    ],
  }
}

/** Publishes the read-only Host rows to the card. */
export class HostInfoCardController {
  private readonly store: SnapshotStore<HostInfoCardState>

  /** @param scope - the bound settings scope for the `host` namespace. */
  constructor(scope: SettingsScope<HostInfoSection>) {
    this.store = createSnapshotStore(project(scope.getSnapshot()))
    scope.subscribe(() => { this.store.set(project(scope.getSnapshot())) })
  }

  /** @returns the card's snapshot source. */
  inject(): HostInfoCardFace {
    return { hooks: { hostInfoCard: this.store } }
  }
}

/** Decoder for the `host` scope: the served section is already the snapshot. */
export const decodeHostInfo = (section: unknown): HostInfoSection | undefined =>
  asSection<HostInfoSection>(section)
