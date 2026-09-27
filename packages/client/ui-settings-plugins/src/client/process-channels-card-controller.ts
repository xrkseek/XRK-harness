/**
 * Read-only channel card (Face `process-channels`).
 *
 * Face publishes what the Host wired at spawn — process `kind: channel`
 * plugins plus the DSH IM vendor stubs — together with the IM gateway mode it
 * resolved from the Host environment (ADR-0006). The section is a discover
 * payload rather than a writable one, so the scope binds a decoder instead of
 * the schema-validation path: the namespace's described schema is an empty
 * object.
 */

import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@xrkseek/client-runtime/client'
import { ABSENT, asSection, type InfoRow } from './info-card-model.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

/** Face namespace of the channel discover payload. */
export const PROCESS_CHANNELS_NS = 'process-channels'

/** One process channel row as Face publishes it. */
interface ProcessChannelEntry {
  readonly pluginId?: string
  readonly channelId?: string
  readonly displayName?: string
}

/** One IM vendor stub as Face publishes it. */
interface ImChannelEntry {
  readonly channelId?: string
  readonly displayName?: string
}

/** The channel discover payload as the card reads it. */
export interface ProcessChannelsSection {
  readonly process?: readonly ProcessChannelEntry[]
  readonly im?: readonly ImChannelEntry[]
  readonly imGatewayWired?: string
  readonly note?: string
}

/** What the channel card renders. */
export interface ProcessChannelsCardState {
  /** `false` hides the card entirely; the namespace is not served. */
  readonly available: boolean
  readonly rows: readonly InfoRow[]
}

/** The registration-side face the channel card's slot entry injects. */
export interface ProcessChannelsCardFace {
  hooks: {
    processChannelsCard: SnapshotStore<ProcessChannelsCardState>
  }
}

/** Locale key naming the Host's IM gateway mode, or absent when it is unknown. */
function gatewayKey(wired: string | undefined): PluginsSettingsLocaleKey {
  if (wired === 'sidecar') return 'channelsImGatewaySidecar'
  if (wired === 'ws-client') return 'channelsImGatewayWsClient'
  if (wired === 'bridge') return 'channelsImGatewayBridge'
  return 'channelsNone'
}

/** Render one channel list as `count · first · second`, or the empty copy. */
function channelList(count: number, names: readonly string[]): InfoRow['value'] {
  return count > 0 ? `${String(count)} · ${names.join(' · ')}` : ''
}

/** Build the card's rows from one scope snapshot. */
function project(snapshot: SettingsScopeSnapshot<ProcessChannelsSection>): ProcessChannelsCardState {
  const value = snapshot.status === 'ready' ? snapshot.value : undefined
  if (value === undefined) return { available: false, rows: [] }
  const process = value.process ?? []
  const im = value.im ?? []
  const processText = channelList(process.length, process.map((row) =>
    row.displayName ?? [row.pluginId, row.channelId].filter(Boolean).join(':')))
  const imText = channelList(im.length, im.map(row => row.displayName ?? row.channelId ?? ''))
  return {
    available: true,
    rows: [
      {
        label: 'channelsImGateway',
        value: '',
        valueKey: gatewayKey(value.imGatewayWired),
      },
      processText.length > 0
        ? { label: 'channelsProcess', value: processText }
        : { label: 'channelsProcess', value: '', valueKey: 'channelsNone' },
      imText.length > 0
        ? { label: 'channelsIm', value: imText }
        : { label: 'channelsIm', value: '', valueKey: 'channelsNone' },
      { label: 'channelsNote', value: value.note !== undefined && value.note.length > 0 ? value.note : ABSENT },
    ],
  }
}

/** Publishes the read-only channel rows to the card. */
export class ProcessChannelsCardController {
  private readonly store: SnapshotStore<ProcessChannelsCardState>

  /** @param scope - the bound settings scope for the `process-channels` namespace. */
  constructor(scope: SettingsScope<ProcessChannelsSection>) {
    this.store = createSnapshotStore(project(scope.getSnapshot()))
    scope.subscribe(() => { this.store.set(project(scope.getSnapshot())) })
  }

  /** @returns the card's snapshot source. */
  inject(): ProcessChannelsCardFace {
    return { hooks: { processChannelsCard: this.store } }
  }
}

/** Decoder for the `process-channels` scope: the served section is the payload. */
export const decodeProcessChannels = (section: unknown): ProcessChannelsSection | undefined =>
  asSection<ProcessChannelsSection>(section)
