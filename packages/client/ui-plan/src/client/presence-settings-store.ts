/** Settings General row store for presence shape + color pickers. */
import { defineStore, type EngineStoreHandle } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_SHAPE,
  type PresenceColor,
  type PresenceKit,
  type PresenceShape,
} from '../presence-settings.ts'

export interface PresencePrefsRowState {
  shape: PresenceShape
  color: PresenceColor
  kit: PresenceKit
  revision: number
}

type PresencePrefsRowActions = {
  sync: (
    draft: PresencePrefsRowState,
    shape: PresenceShape,
    color: PresenceColor,
    kit: PresenceKit,
    revision: number,
  ) => void
}

/** Declares the presence prefs row state and write surface. */
export function createPresencePrefsRowStore(): EngineStoreHandle<
  PresencePrefsRowState,
  PresencePrefsRowActions
> {
  return defineStore({
    init: (): PresencePrefsRowState => ({
      shape: DEFAULT_PRESENCE_SHAPE,
      color: DEFAULT_PRESENCE_COLOR,
      kit: DEFAULT_PRESENCE_KIT,
      revision: -1,
    }),
    actions: {
      sync: (d, shape, color, kit, revision) => {
        if (revision <= d.revision) return
        d.shape = shape
        d.color = color
        d.kit = kit
        d.revision = revision
      },
    },
  })
}

/** @deprecated alias — prefer {@link createPresencePrefsRowStore}. */
export const createPresenceShapeRowStore = createPresencePrefsRowStore
