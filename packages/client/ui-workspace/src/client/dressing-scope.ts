/** Host `ui-presence` sticker library shared by Agent Team and Settings. */
import { useSyncExternalStore } from 'react'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  encodeStickers,
  parseSlotPick,
  parseStickers,
  PRESENCE_NS,
  PRESENCE_STICKERS_MAX,
  parseOverlayImage,
  stickerIdFromPick,
  stickerRef,
  type DressingSlot,
  type DressingSticker,
} from './dressing-library.ts'
import {
  DEFAULT_SEAT_TITLE_SCHEME,
  resolveSeatTitles,
  seatTitlesForScheme,
  type SeatTitles,
} from './seat-titles.ts'

type PresenceNs = {
  /** Master switch shared with Settings → Plugins presence card. */
  readonly enabled?: boolean
  readonly stickers?: string
  /** Boss seat look — edited in 干员团队, not Plugins. */
  readonly shape?: string
  readonly color?: string
  readonly kit?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
  /** Boss display nick — edited in 干员团队 (not the Overview ball sheet). */
  readonly bossNickname?: string
  readonly titleScheme?: string
  readonly titleBoss?: string
  readonly titleManager?: string
  readonly titleAgent?: string
}

/** Live Boss companion look from Host `ui-presence`. */
export type BossLook = {
  readonly shape: string
  readonly color: string
  readonly kitHat: string
  readonly kitGlasses: string
  readonly kitHeld: string
}

const BOSS_NICKNAME_MAX = 24
const DEFAULT_BOSS_NICKNAME = ''

const DEFAULT_BOSS_LOOK: BossLook = {
  shape: 'blob',
  color: 'cream',
  kitHat: 'none',
  kitGlasses: 'none',
  kitHeld: 'none',
}

const SHAPE_IDS = new Set([
  'blob', 'wedge', 'gem', 'squircle', 'drop', 'pill', 'petal', 'loaf',
  'heart', 'star', 'hex', 'egg', 'cloud', 'shield',
])
const COLOR_IDS = new Set([
  'cream', 'mist', 'peach', 'sage', 'lilac', 'slate', 'coral', 'butter',
  'mint', 'sky', 'rose', 'cocoa', 'honey', 'ocean', 'grape', 'blush',
  'sand', 'ink', 'ice', 'matcha',
])
const HAT_IDS = new Set(['none', 'bow', 'cap', 'beanie', 'visor', 'halo'])
const GLASSES_IDS = new Set(['none', 'specs', 'specs-rect', 'specs-cat', 'specs-sun'])
const HELD_IDS = new Set(['none', 'flower', 'tea', 'flag', 'spark'])

function slotOrSticker(raw: unknown, builtins: ReadonlySet<string>): string {
  if (typeof raw !== 'string') return 'none'
  const value = raw.trim()
  if (!value) return 'none'
  if (builtins.has(value)) return value
  if (stickerIdFromPick(value) || value.startsWith('sticker:')) return value
  return 'none'
}

let bossLookCache: BossLook | undefined

function readBossLook(): BossLook {
  if (!host) {
    bossLookCache = undefined
    return DEFAULT_BOSS_LOOK
  }
  const value = host.getSnapshot().value
  const shape = typeof value?.shape === 'string' && SHAPE_IDS.has(value.shape)
    ? value.shape
    : DEFAULT_BOSS_LOOK.shape
  const color = typeof value?.color === 'string' && COLOR_IDS.has(value.color)
    ? value.color
    : DEFAULT_BOSS_LOOK.color
  const legacy = typeof value?.kit === 'string' ? value.kit : undefined
  // Prefer split slots; fall back to legacy single kit string when slots empty.
  let kitHat = slotOrSticker(value?.kitHat, HAT_IDS)
  let kitGlasses = slotOrSticker(value?.kitGlasses, GLASSES_IDS)
  const kitHeld = slotOrSticker(value?.kitHeld, HELD_IDS)
  if (kitHat === 'none' && kitGlasses === 'none' && legacy) {
    const parts = legacy.split('+').map((p) => p.trim()).filter(Boolean)
    for (const part of parts) {
      if (HAT_IDS.has(part) && kitHat === 'none') kitHat = part
      else if (GLASSES_IDS.has(part) && kitGlasses === 'none') kitGlasses = part
    }
  }
  // useSyncExternalStore requires a stable snapshot reference while data is
  // unchanged — a fresh object every read trips React #185 (max update depth).
  const cached = bossLookCache
  if (
    cached
    && cached.shape === shape
    && cached.color === color
    && cached.kitHat === kitHat
    && cached.kitGlasses === kitGlasses
    && cached.kitHeld === kitHeld
  ) {
    return cached
  }
  const next: BossLook = { shape, color, kitHat, kitGlasses, kitHeld }
  bossLookCache = next
  return next
}

function parseBossNickname(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_BOSS_NICKNAME
  return raw.trim().slice(0, BOSS_NICKNAME_MAX)
}

function readBossNickname(): string {
  if (!host) return DEFAULT_BOSS_NICKNAME
  return parseBossNickname(host.getSnapshot().value?.bossNickname)
}

const EMPTY_STICKERS: readonly DressingSticker[] = []
/** Match ui-plan DEFAULT_PRESENCE_ENABLED when Host has not answered yet. */
const DEFAULT_PRESENCE_MODULE_ON = true
const DEFAULT_SEAT_TITLES: SeatTitles =
  seatTitlesForScheme(DEFAULT_SEAT_TITLE_SCHEME, 'zh')

let host: SettingsScope<PresenceNs> | undefined
let stickersCache: { readonly raw: unknown; readonly rows: readonly DressingSticker[] } | undefined
/** Active UI language for locale-aware seat-title presets (mirrors ui-plan). */
let uiLocale: 'zh' | 'en' | 'ja' = 'zh'
let seatTitlesCache: SeatTitles | undefined

function readStickers(): readonly DressingSticker[] {
  if (!host) {
    stickersCache = undefined
    return EMPTY_STICKERS
  }
  const raw = host.getSnapshot().value?.stickers
  if (stickersCache && Object.is(stickersCache.raw, raw)) return stickersCache.rows
  const parsed = parseStickers(raw)
  const rows = parsed.length === 0 ? EMPTY_STICKERS : parsed
  stickersCache = { raw, rows }
  return rows
}

function readPresenceModuleEnabled(): boolean {
  if (!host) return DEFAULT_PRESENCE_MODULE_ON
  const value = host.getSnapshot().value?.enabled
  return typeof value === 'boolean' ? value : DEFAULT_PRESENCE_MODULE_ON
}

export function bindDressingHost(scope: SettingsScope<PresenceNs>): void {
  host = scope
  stickersCache = undefined
  seatTitlesCache = undefined
  bossLookCache = undefined
}

/** Keep Agent Team seat labels in sync with the shell UI language. */
export function bindSeatTitleLocale(locale: string): void {
  const next = locale === 'en' || locale === 'ja' ? locale : 'zh'
  if (uiLocale === next) return
  uiLocale = next
  seatTitlesCache = undefined
}

function readSeatTitles(): SeatTitles {
  if (!host) {
    seatTitlesCache = undefined
    return seatTitlesForScheme(DEFAULT_SEAT_TITLE_SCHEME, uiLocale)
  }
  const value = host.getSnapshot().value
  const next = resolveSeatTitles({
    titleScheme: value?.titleScheme,
    titleBoss: value?.titleBoss,
    titleManager: value?.titleManager,
    titleAgent: value?.titleAgent,
    locale: uiLocale,
  })
  const cached = seatTitlesCache
  if (
    cached
    && cached.boss === next.boss
    && cached.manager === next.manager
    && cached.agent === next.agent
  ) {
    return cached
  }
  seatTitlesCache = next
  return next
}

export function useDressingStickers(): readonly DressingSticker[] {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readStickers,
    () => EMPTY_STICKERS,
  )
}

/**
 * Whether the presence / emotion-ball module is on.
 * When false, Agent Team roster shows initials instead of CompanionBalls.
 */
export function usePresenceModuleEnabled(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readPresenceModuleEnabled,
    () => DEFAULT_PRESENCE_MODULE_ON,
  )
}

/** Live 上层 / 中层 / 下层 titles for catalog labels and hints. */
export function useSeatTitles(): SeatTitles {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readSeatTitles,
    () => DEFAULT_SEAT_TITLES,
  )
}

export function addDressingSticker(image: string, slot: DressingSlot): string | undefined {
  const parsed = parseOverlayImage(image)
  if (!parsed || !host) return undefined
  const rows = readStickers()
  if (rows.length >= PRESENCE_STICKERS_MAX) return undefined
  const id = `stk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
  void host.set('stickers', encodeStickers([...rows, { id, image: parsed, slot }]))
  return id
}

export function removeDressingSticker(id: string): void {
  if (!host) return
  const section = host.getSnapshot().value
  const rows = readStickers().filter((row) => row.id !== id)
  const ref = stickerRef(id)
  const ops: Array<
    | { op: 'set'; path: string[]; value: unknown }
    | { op: 'unset'; path: string[] }
  > = [
    { op: 'set', path: ['stickers'], value: encodeStickers(rows) },
  ]
  if (parseSlotPick(section?.kitHat, []) === ref) {
    ops.push({ op: 'set', path: ['kitHat'], value: 'none' })
  }
  if (parseSlotPick(section?.kitGlasses, []) === ref) {
    ops.push({ op: 'set', path: ['kitGlasses'], value: 'none' })
  }
  if (parseSlotPick(section?.kitHeld, []) === ref) {
    ops.push({ op: 'set', path: ['kitHeld'], value: 'none' })
  }
  void host.patch(ops)
}

/** Subscribe to Boss seat look (shape / color / 装扮 slots). */
export function useBossLook(): BossLook {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readBossLook,
    () => DEFAULT_BOSS_LOOK,
  )
}

/** Persist one Boss look field into Host `ui-presence` (live, no Save). */
export function setBossLookField(
  field: 'shape' | 'color' | 'kitHat' | 'kitGlasses' | 'kitHeld',
  next: string,
): void {
  if (!host) return
  const value = next.trim()
  if (field === 'shape') {
    if (!SHAPE_IDS.has(value)) return
    void host.set('shape', value)
    return
  }
  if (field === 'color') {
    if (!COLOR_IDS.has(value)) return
    void host.set('color', value)
    return
  }
  if (field === 'kitHat') {
    void host.set('kitHat', slotOrSticker(value, HAT_IDS))
    return
  }
  if (field === 'kitGlasses') {
    void host.set('kitGlasses', slotOrSticker(value, GLASSES_IDS))
    return
  }
  void host.set('kitHeld', slotOrSticker(value, HELD_IDS))
}

/** Live Boss nick from Host `ui-presence` (Overview ball caption). */
export function useBossNickname(): string {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readBossNickname,
    () => DEFAULT_BOSS_NICKNAME,
  )
}

/** Persist Boss nick into Host `ui-presence` (live; edited in 干员团队). */
export function setBossNickname(nickname: string): void {
  if (!host) return
  const next = parseBossNickname(nickname)
  if (readBossNickname() === next) return
  void host.set('bossNickname', next)
}

export { BOSS_NICKNAME_MAX, PRESENCE_NS, stickerIdFromPick, stickerRef }
