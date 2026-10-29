/** Settings General row store for presence shape + color pickers. */
import { defineStore, type EngineStoreHandle } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_ENABLED,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_MOOD_AT,
  DEFAULT_PRESENCE_MOOD_ID,
  DEFAULT_PRESENCE_SHAPE,
  DEFAULT_PRESENCE_STATUS_LINE,
  DEFAULT_PRESENCE_TITLE_SCHEME,
  DEFAULT_STATUS_PRESETS,
  type PresenceColor,
  type PresenceKit,
  type PresenceShape,
  type PresenceSticker,
  type PresenceTitleSchemeId,
} from '../presence-settings.ts'

export interface PresencePrefsRowState {
  enabled: boolean
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
  moodId: string
  statusLine: string
  moodAt: number
  statusPresets: readonly string[]
  titleScheme: PresenceTitleSchemeId
  titleBoss: string
  titleManager: string
  titleAgent: string
  revision: number
}

type PresencePrefsRowActions = {
  sync: (
    draft: PresencePrefsRowState,
    enabled: boolean,
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
    moodId: string,
    statusLine: string,
    moodAt: number,
    statusPresets: readonly string[],
    titleScheme: PresenceTitleSchemeId,
    titleBoss: string,
    titleManager: string,
    titleAgent: string,
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
      enabled: DEFAULT_PRESENCE_ENABLED,
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
      moodId: DEFAULT_PRESENCE_MOOD_ID,
      statusLine: DEFAULT_PRESENCE_STATUS_LINE,
      moodAt: DEFAULT_PRESENCE_MOOD_AT,
      statusPresets: [...DEFAULT_STATUS_PRESETS],
      titleScheme: DEFAULT_PRESENCE_TITLE_SCHEME,
      titleBoss: '',
      titleManager: '',
      titleAgent: '',
      revision: -1,
    }),
    actions: {
      sync: (
        d,
        enabled,
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
        moodId,
        statusLine,
        moodAt,
        statusPresets,
        titleScheme,
        titleBoss,
        titleManager,
        titleAgent,
        revision,
      ) => {
        if (revision <= d.revision) return
        d.enabled = enabled
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
        d.moodId = moodId
        d.statusLine = statusLine
        d.moodAt = moodAt
        d.statusPresets = statusPresets
        d.titleScheme = titleScheme
        d.titleBoss = titleBoss
        d.titleManager = titleManager
        d.titleAgent = titleAgent
        d.revision = revision
      },
    },
  })
}

/** @deprecated alias — prefer {@link createPresencePrefsRowStore}. */
export const createPresenceShapeRowStore = createPresencePrefsRowStore
