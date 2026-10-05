/** Settings General row store for presence shape + color pickers. */
import { defineStore, type EngineStoreHandle } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_SHAPE,
  type PresenceColor,
  type PresenceKit,
  type PresenceShape,
  type PresenceSticker,
} from '../presence-settings.ts'

export interface PresencePrefsRowState {
  shape: PresenceShape
  color: PresenceColor
  kit: PresenceKit
  kitHat: string
  kitGlasses: string
  kitHeld: string
  overlayHat: string
  overlayGlasses: string
  overlayHeld: string
  stickers: readonly PresenceSticker[]
  revision: number
}

type PresencePrefsRowActions = {
  sync: (
    draft: PresencePrefsRowState,
    shape: PresenceShape,
    color: PresenceColor,
    kit: PresenceKit,
    kitHat: string,
    kitGlasses: string,
    kitHeld: string,
    overlayHat: string,
    overlayGlasses: string,
    overlayHeld: string,
    stickers: readonly PresenceSticker[],
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
      kitHat: 'none',
      kitGlasses: 'none',
      kitHeld: 'none',
      overlayHat: '',
      overlayGlasses: '',
      overlayHeld: '',
      stickers: [],
      revision: -1,
    }),
    actions: {
      sync: (
        d,
        shape,
        color,
        kit,
        kitHat,
        kitGlasses,
        kitHeld,
        overlayHat,
        overlayGlasses,
        overlayHeld,
        stickers,
        revision,
      ) => {
        if (revision <= d.revision) return
        d.shape = shape
        d.color = color
        d.kit = kit
        d.kitHat = kitHat
        d.kitGlasses = kitGlasses
        d.kitHeld = kitHeld
        d.overlayHat = overlayHat
        d.overlayGlasses = overlayGlasses
        d.overlayHeld = overlayHeld
        d.stickers = stickers
        d.revision = revision
      },
    },
  })
}

/** @deprecated alias — prefer {@link createPresencePrefsRowStore}. */
export const createPresenceShapeRowStore = createPresencePrefsRowStore
