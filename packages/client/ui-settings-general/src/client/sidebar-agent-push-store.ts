/** Staged snapshot over Host sidebar prefs for agent-opens / agent-terminals push. */

import { createSnapshotStore, type SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  loadSidebarAgentPushPrefs,
  patchSidebarAgentPushPref,
  type SidebarAgentPushPrefKey,
} from './sidebar-prefs-api.ts'

/** What the General rows render. */
export interface SidebarAgentPushState {
  /** `unavailable` when the Host sidebar prefs API is missing. */
  readonly status: 'loading' | 'ready' | 'saving' | 'unavailable'
  readonly agentOpenTools: boolean
  readonly agentTerminalTools: boolean
  readonly error: string | null
}

const INITIAL: SidebarAgentPushState = {
  status: 'loading',
  agentOpenTools: false,
  agentTerminalTools: false,
  error: null,
}

/** Loads and patches `agentOpenTools` / `agentTerminalTools` in prefs.json. */
export class SidebarAgentPushStore {
  readonly store: SnapshotStore<SidebarAgentPushState> = createSnapshotStore(INITIAL)
  private readonly fetchImpl: typeof fetch
  private loadGen = 0

  /** @param fetchImpl - injectable for tests; defaults to `globalThis.fetch`. */
  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl
  }

  /** Fetch current prefs (idempotent; last call wins). */
  async load(): Promise<void> {
    const gen = ++this.loadGen
    this.store.set({ ...this.store.getSnapshot(), status: 'loading', error: null })
    const prefs = await loadSidebarAgentPushPrefs(this.fetchImpl)
    if (gen !== this.loadGen) return
    if (!prefs) {
      this.store.set({
        status: 'unavailable',
        agentOpenTools: false,
        agentTerminalTools: false,
        error: null,
      })
      return
    }
    this.store.set({
      status: 'ready',
      agentOpenTools: prefs.agentOpenTools,
      agentTerminalTools: prefs.agentTerminalTools,
      error: null,
    })
  }

  /** Flip one push gate and persist via `settings.update`. */
  async set(key: SidebarAgentPushPrefKey, value: boolean): Promise<void> {
    const prev = this.store.getSnapshot()
    if (prev.status === 'unavailable') return
    this.store.set({
      ...prev,
      status: 'saving',
      [key]: value,
      error: null,
    })
    const prefs = await patchSidebarAgentPushPref(key, value, this.fetchImpl)
    if (!prefs) {
      this.store.set({
        ...prev,
        status: 'ready',
        error: 'save-failed',
      })
      return
    }
    this.store.set({
      status: 'ready',
      agentOpenTools: prefs.agentOpenTools,
      agentTerminalTools: prefs.agentTerminalTools,
      error: null,
    })
  }
}
