/**
 * Release-notes read state. Durable in Host settings, process-local for a
 * remote browser (its settings wire is loopback-only, mirroring the welcome
 * notice's posture). The notes copy itself is static — see release-notes.ts.
 */

import type { IApiClient, SettingsNamespaceView } from '@xrkseek/xrk-api-remotes/client'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import {
  RELEASE_NOTES_ACK_FIELD, RELEASE_NOTES_SETTINGS_NAMESPACE,
} from './release-notes-copy.ts'
import { latestReleaseVersion } from './release-notes.ts'

/** State rendered by the sidebar button and its dialog. */
export interface ReleaseNotesState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** Whether any note newer than the acknowledged marker is unread. */
  unread: boolean
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readMarker(view: SettingsNamespaceView): string | undefined {
  if (typeof view.value !== 'object' || view.value === null) return undefined
  const value = (view.value as Record<string, unknown>)[RELEASE_NOTES_ACK_FIELD]
  return typeof value === 'string' ? value : undefined
}

/**
 * A read marker covers every note up to and including its version: notes are
 * ordered newest-first, so "is the newest note unread" is "is the newest
 * version listed after the acknowledged one".
 */
function hasUnread(acknowledged: string | undefined): boolean {
  const latest = latestReleaseVersion()
  if (latest === undefined) return false
  return acknowledged !== latest
}

/** Coordinates the durable read marker with the button's red dot. */
export class ReleaseNotesStore {
  /** uSES-safe state source shared by the registered button. */
  readonly store: SnapshotStore<ReleaseNotesState> = createSnapshotStore({
    status: 'idle', unread: true, error: null,
  })

  private generation = 0

  /**
   * @param api - settings wire face used for durable reads and writes.
   * @param persistence - remote browsers use memory because settings is loopback-only.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings'>,
    private readonly persistence: 'host' | 'memory' = 'host',
  ) {}

  /** Load the read marker from Host settings, or settle as read for a remote browser. */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.persistence === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.unread = false
        state.error = null
      })
      return
    }
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const view = response.result.value.namespaces.find(
        candidate => candidate.ns === RELEASE_NOTES_SETTINGS_NAMESPACE,
      )
      if (view === undefined) throw new Error('release notes settings are unavailable')
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.unread = hasUnread(readMarker(view))
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        // An unread load failure must not fabricate a "read" state and hide
        // notes the user has never seen; keep the dot and surface the reason.
        state.status = 'error'
        state.unread = true
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Mark every note currently bundled as read.
   * @returns true when the selected persistence mode accepted the marker.
   */
  async markRead(): Promise<boolean> {
    const latest = latestReleaseVersion()
    if (latest === undefined) return true
    const generation = ++this.generation
    if (this.persistence === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.unread = false
        state.error = null
      })
      return true
    }
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.settings.mutate({
        ns: RELEASE_NOTES_SETTINGS_NAMESPACE,
        ops: [{ op: 'set', path: [RELEASE_NOTES_ACK_FIELD], value: latest }],
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation === this.generation) {
        this.store.update((state) => {
          state.status = 'ready'
          state.unread = false
          state.error = null
        })
      }
      return true
    } catch (error) {
      if (generation === this.generation) {
        this.store.update((state) => {
          state.status = 'error'
          state.unread = true
          state.error = messageOf(error)
        })
      }
      return false
    }
  }
}