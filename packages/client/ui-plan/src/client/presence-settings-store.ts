/**
 * Plugins-home presence card store.
 *
 * Only what the card renders lives here: master switch, seat titles, and tip
 * presets. The companion look (shape / preset color / custom colors / size /
 * kit) is edited in 干员团队 and read straight from `PresenceSettingsRuntime`
 * by the ball, so mirroring it into this store would just create a second,
 * staler copy of the truth.
 */
import { defineStore, type EngineStoreHandle } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_ENABLED,
  DEFAULT_PRESENCE_TITLE_SCHEME,
  DEFAULT_STATUS_PRESETS,
  type PresenceTitleSchemeId,
} from '../presence-settings.ts'

/** One Host→card projection; object arg so fields cannot silently misalign. */
export interface PresencePrefsSnapshot {
  enabled: boolean
  statusPresets: readonly string[]
  titleScheme: PresenceTitleSchemeId
  titleBoss: string
  titleManager: string
  titleAgent: string
  revision: number
}

export type PresencePrefsRowState = PresencePrefsSnapshot

type PresencePrefsRowActions = {
  sync: (draft: PresencePrefsRowState, next: PresencePrefsSnapshot) => void
}

/** Declares the presence card row state and write surface. */
export function createPresencePrefsRowStore(): EngineStoreHandle<
  PresencePrefsRowState,
  PresencePrefsRowActions
> {
  return defineStore({
    init: (): PresencePrefsRowState => ({
      enabled: DEFAULT_PRESENCE_ENABLED,
      statusPresets: [...DEFAULT_STATUS_PRESETS],
      titleScheme: DEFAULT_PRESENCE_TITLE_SCHEME,
      titleBoss: '',
      titleManager: '',
      titleAgent: '',
      revision: -1,
    }),
    actions: {
      sync: (d, next) => {
        // Host revisions only ever grow; a stale projection must not rewind
        // a newer one (the card and the ball subscribe to the same runtime).
        if (next.revision <= d.revision) return
        d.enabled = next.enabled
        d.statusPresets = next.statusPresets
        d.titleScheme = next.titleScheme
        d.titleBoss = next.titleBoss
        d.titleManager = next.titleManager
        d.titleAgent = next.titleAgent
        d.revision = next.revision
      },
    },
  })
}

/** @deprecated alias — prefer {@link createPresencePrefsRowStore}. */
export const createPresenceShapeRowStore = createPresencePrefsRowStore
