/** Presence companion preferences in the Host user-settings document. */

import z from '@xrkseek/schemastery'

/** Body shapes shipped in apps/web/public/presence/emotion-ball. */
export const PRESENCE_SHAPES = [
  'blob',
  'wedge',
  'gem',
  'squircle',
  'drop',
  'pill',
  'petal',
  'loaf',
  'heart',
  'star',
  'hex',
  'egg',
  'cloud',
  'shield',
] as const

/**
 * Named body palettes. Each has a warm light-mode fill and a darker companion
 * for dark chrome — never pure `#fff` / `#000` (engine default cream is `#F3F0EA`).
 */
export const PRESENCE_COLORS = [
  'cream',
  'mist',
  'peach',
  'sage',
  'lilac',
  'slate',
  'coral',
  'butter',
  'mint',
  'sky',
  'rose',
  'cocoa',
  'honey',
  'ocean',
  'grape',
  'blush',
  'sand',
  'ink',
  'ice',
  'matcha',
] as const

export const PRESENCE_KITS = [
  'none',
  'bow',
  'cap',
  'beanie',
  'visor',
  'specs',
  'specs-rect',
  'specs-cat',
  'specs-sun',
  'halo',
] as const

/** Settings namespace owned by the ui-plan presence surface. */
export const PRESENCE_SETTINGS_NAMESPACE = 'ui-presence'

/** Master switch: hide header dock + Overview rail without touching chat. */
export const PRESENCE_ENABLED_FIELD = 'enabled'
export const DEFAULT_PRESENCE_ENABLED = true

export const PRESENCE_SHAPE_FIELD = 'shape'
export const PRESENCE_COLOR_FIELD = 'color'
export const PRESENCE_KIT_FIELD = 'kit'
export const PRESENCE_OVERLAY_HAT_FIELD = 'overlayHat'
export const PRESENCE_OVERLAY_GLASSES_FIELD = 'overlayGlasses'
export const PRESENCE_OVERLAY_HELD_FIELD = 'overlayHeld'
export const PRESENCE_STICKERS_FIELD = 'stickers'
export const PRESENCE_KIT_HAT_FIELD = 'kitHat'
export const PRESENCE_KIT_GLASSES_FIELD = 'kitGlasses'
export const PRESENCE_KIT_HELD_FIELD = 'kitHeld'
/** Operator (Boss) work mood — emotion-ball id; Overview left seat. */
export const PRESENCE_MOOD_ID_FIELD = 'moodId'
export const PRESENCE_STATUS_LINE_FIELD = 'statusLine'
export const PRESENCE_BOSS_NICKNAME_FIELD = 'bossNickname'
export const PRESENCE_MOOD_AT_FIELD = 'moodAt'
/** JSON string[] of tip chips users can pick on Overview (Plugins card edits). */
export const PRESENCE_STATUS_PRESETS_FIELD = 'statusPresets'
/**
 * Seat-title prefs live in `ui-presence` for Host co-location with Boss mood,
 * but they are NOT gated by the presence-ball appearance switch.
 */
export const PRESENCE_TITLE_SCHEME_FIELD = 'titleScheme'
export const PRESENCE_TITLE_BOSS_FIELD = 'titleBoss'
export const PRESENCE_TITLE_MANAGER_FIELD = 'titleManager'
export const PRESENCE_TITLE_AGENT_FIELD = 'titleAgent'
export const DEFAULT_PRESENCE_MOOD_ID = '16'
export const DEFAULT_PRESENCE_STATUS_LINE = ''
export const DEFAULT_PRESENCE_BOSS_NICKNAME = ''
export const DEFAULT_PRESENCE_MOOD_AT = 0
export const PRESENCE_BOSS_NICKNAME_MAX = 24
export const PRESENCE_SEAT_TITLE_MAX = 24

/** Classic three-tier seat-title presets (locale supplies the words). */
export const PRESENCE_TITLE_SCHEMES = [
  'office',
  'corp',
  'crew',
  'guild',
] as const

export type PresenceTitleSchemeId = (typeof PRESENCE_TITLE_SCHEMES)[number]
export type PresenceTitleLocale = 'zh' | 'en' | 'ja'

export type PresenceSeatTitles = {
  readonly boss: string
  readonly manager: string
  readonly agent: string
}

export const DEFAULT_PRESENCE_TITLE_SCHEME: PresenceTitleSchemeId = 'office'

const PRESENCE_SCHEME_TITLES: Readonly<
  Record<PresenceTitleSchemeId, Readonly<Record<PresenceTitleLocale, PresenceSeatTitles>>>
> = {
  office: {
    zh: { boss: '老板', manager: '经理', agent: '干员' },
    en: { boss: 'Boss', manager: 'Manager', agent: 'Agent' },
    ja: { boss: 'ボス', manager: 'マネージャー', agent: 'エージェント' },
  },
  corp: {
    zh: { boss: '总裁', manager: '主管', agent: '专员' },
    en: { boss: 'CEO', manager: 'Lead', agent: 'Specialist' },
    ja: { boss: '社長', manager: '課長', agent: '担当' },
  },
  crew: {
    zh: { boss: '船长', manager: '大副', agent: '水手' },
    en: { boss: 'Captain', manager: 'First mate', agent: 'Crew' },
    ja: { boss: '船長', manager: '一等航海士', agent: '船員' },
  },
  guild: {
    zh: { boss: '会长', manager: '干部', agent: '成员' },
    en: { boss: 'Guild master', manager: 'Officer', agent: 'Member' },
    ja: { boss: '会長', manager: '幹部', agent: 'メンバー' },
  },
}

export const DEFAULT_PRESENCE_SEAT_TITLES: PresenceSeatTitles =
  PRESENCE_SCHEME_TITLES[DEFAULT_PRESENCE_TITLE_SCHEME].zh

export function isPresenceTitleSchemeId(raw: unknown): raw is PresenceTitleSchemeId {
  return typeof raw === 'string'
    && (PRESENCE_TITLE_SCHEMES as readonly string[]).includes(raw)
}

/** Legacy `en` preset → office (words follow UI locale). */
export function parseTitleScheme(raw: unknown): PresenceTitleSchemeId {
  if (raw === 'en') return 'office'
  return isPresenceTitleSchemeId(raw) ? raw : DEFAULT_PRESENCE_TITLE_SCHEME
}

export function parseTitleLocale(raw: unknown): PresenceTitleLocale {
  return raw === 'en' || raw === 'ja' ? raw : 'zh'
}

export function seatTitlesForScheme(
  scheme: PresenceTitleSchemeId,
  locale: PresenceTitleLocale = 'zh',
): PresenceSeatTitles {
  return PRESENCE_SCHEME_TITLES[scheme][locale]
}

export function parseSeatTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, PRESENCE_SEAT_TITLE_MAX)
}

/** Custom fields win (any language); empty → preset in the given UI locale. */
export function resolveSeatTitles(input: {
  readonly titleScheme?: unknown
  readonly titleBoss?: unknown
  readonly titleManager?: unknown
  readonly titleAgent?: unknown
  readonly locale?: unknown
}): PresenceSeatTitles {
  const defaults = seatTitlesForScheme(
    parseTitleScheme(input.titleScheme),
    parseTitleLocale(input.locale),
  )
  return {
    boss: parseSeatTitle(input.titleBoss) || defaults.boss,
    manager: parseSeatTitle(input.titleManager) || defaults.manager,
    agent: parseSeatTitle(input.titleAgent) || defaults.agent,
  }
}

/** True when the three live titles still match a built-in locale variant. */
export function matchTitleScheme(
  titles: PresenceSeatTitles,
): PresenceTitleSchemeId | undefined {
  for (const id of PRESENCE_TITLE_SCHEMES) {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      const row = PRESENCE_SCHEME_TITLES[id][locale]
      if (
        row.boss === titles.boss
        && row.manager === titles.manager
        && row.agent === titles.agent
      ) {
        return id
      }
    }
  }
  return undefined
}
/** Factory Boss tip chips — Chinese product default (also Host legacy seed). */
export const DEFAULT_STATUS_PRESETS_ZH: readonly string[] = [
  '摸鱼中',
  '认真打工',
  '开会中',
  '咖啡续命',
  '别催我',
  '灵感来了',
  '等回复',
  '深潜 debug',
]

/** Factory Boss tip chips for English UI. */
export const DEFAULT_STATUS_PRESETS_EN: readonly string[] = [
  'Slacking',
  'Heads down',
  'In a meeting',
  'Coffee first',
  "Don't ping",
  'Idea spark',
  'Waiting on reply',
  'Deep debug',
]

/** Factory Boss tip chips for Japanese UI. */
export const DEFAULT_STATUS_PRESETS_JA: readonly string[] = [
  'サボり中',
  '本気稼働',
  '会議中',
  'コーヒー補給',
  '催促しないで',
  'ひらめき中',
  '返信待ち',
  '深潜デバッグ',
]

/** @deprecated Prefer {@link DEFAULT_STATUS_PRESETS_ZH} / locale resolve. */
export const DEFAULT_STATUS_PRESETS: readonly string[] = DEFAULT_STATUS_PRESETS_ZH

function samePresetList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tip, i) => tip === b[i])
}

/** True when the list is still an untouched factory set (any shipped language). */
export function isFactoryStatusPresets(rows: readonly string[]): boolean {
  return samePresetList(rows, DEFAULT_STATUS_PRESETS_ZH)
    || samePresetList(rows, DEFAULT_STATUS_PRESETS_EN)
    || samePresetList(rows, DEFAULT_STATUS_PRESETS_JA)
}

/**
 * Resolve tip chips for the active UI language. Empty / factory lists follow
 * locale; customized lists stay as the user wrote them.
 */
export function resolveStatusPresetsForLocale(
  stored: readonly string[],
  locale: 'zh' | 'en' | 'ja',
): string[] {
  if (stored.length === 0 || isFactoryStatusPresets(stored)) {
    if (locale === 'en') return [...DEFAULT_STATUS_PRESETS_EN]
    if (locale === 'ja') return [...DEFAULT_STATUS_PRESETS_JA]
    return [...DEFAULT_STATUS_PRESETS_ZH]
  }
  return [...stored]
}
export const PRESENCE_STATUS_PRESETS_MAX = 16
export const PRESENCE_STATUS_LINE_MAX = 80
/** Quick moods on the Overview Boss sheet (subset of emotion catalog). */
export const BOSS_QUICK_MOOD_IDS = [
  '16',
  '10',
  '15',
  '04',
  '30',
  '00',
  '19',
  '17',
  '18',
  '03',
  '21',
  '33',
] as const
/** data URL cap — same as Agent Team MEMBER_FACE_MAX. */
export const PRESENCE_OVERLAY_MAX = 80_000
export const PRESENCE_STICKERS_MAX = 24
export const STICKER_PREFIX = 'sticker:'

export const PRESENCE_HAT_KITS = ['none', 'bow', 'cap', 'beanie', 'visor', 'halo'] as const
export const PRESENCE_GLASSES_KITS = ['none', 'specs', 'specs-rect', 'specs-cat', 'specs-sun'] as const
export const PRESENCE_HELD_KITS = ['none', 'flower', 'tea', 'flag', 'spark'] as const

export type PresenceHatKit = (typeof PRESENCE_HAT_KITS)[number]
export type PresenceGlassesKit = (typeof PRESENCE_GLASSES_KITS)[number]
export type PresenceHeldKit = (typeof PRESENCE_HELD_KITS)[number]

export type PresenceSticker = {
  readonly id: string
  readonly image: string
  readonly slot: 'hat' | 'glasses' | 'held'
}

export type PresenceShape = (typeof PRESENCE_SHAPES)[number]
export type PresenceColor = (typeof PRESENCE_COLORS)[number]
export type PresenceKit = (typeof PRESENCE_KITS)[number]

export const DEFAULT_PRESENCE_SHAPE: PresenceShape = 'blob'
/** Matches emotion-ball idle body (`#F3F0EA`), not pure white. */
export const DEFAULT_PRESENCE_COLOR: PresenceColor = 'cream'
export const DEFAULT_PRESENCE_KIT: PresenceKit = 'none'

export type PresencePaint = {
  readonly body: string
  readonly eyes: string
}

export type PresenceColorModes = {
  readonly light: PresencePaint
  readonly dark: PresencePaint
}

/** Resolved fills for each named palette (light UI / dark UI). */
export const PRESENCE_COLOR_PALETTES: Record<PresenceColor, PresenceColorModes> = {
  cream: {
    light: { body: '#F3F0EA', eyes: '#1A1A1A' },
    dark: { body: '#E4E0D8', eyes: '#1A1A1A' },
  },
  mist: {
    light: { body: '#D4E0EC', eyes: '#1A1A1A' },
    dark: { body: '#9AABB8', eyes: '#1A1A1A' },
  },
  peach: {
    light: { body: '#F0D8C8', eyes: '#1A1A1A' },
    dark: { body: '#C4A090', eyes: '#1A1A1A' },
  },
  sage: {
    light: { body: '#D4E5C8', eyes: '#1A1A1A' },
    dark: { body: '#96B088', eyes: '#1A1A1A' },
  },
  lilac: {
    light: { body: '#E5D4E8', eyes: '#1A1A1A' },
    dark: { body: '#B098B8', eyes: '#1A1A1A' },
  },
  slate: {
    light: { body: '#C8CDD4', eyes: '#1A1A1A' },
    dark: { body: '#5A6068', eyes: '#F0EEE8' },
  },
  coral: {
    light: { body: '#F0C8BC', eyes: '#1A1A1A' },
    dark: { body: '#C48A7C', eyes: '#1A1A1A' },
  },
  butter: {
    light: { body: '#F2E4B0', eyes: '#1A1A1A' },
    dark: { body: '#C4B070', eyes: '#1A1A1A' },
  },
  mint: {
    light: { body: '#C8E8DC', eyes: '#1A1A1A' },
    dark: { body: '#7ABAA8', eyes: '#1A1A1A' },
  },
  sky: {
    light: { body: '#C5DCF0', eyes: '#1A1A1A' },
    dark: { body: '#7A9BB8', eyes: '#1A1A1A' },
  },
  rose: {
    light: { body: '#E8C8D4', eyes: '#1A1A1A' },
    dark: { body: '#B8889C', eyes: '#1A1A1A' },
  },
  cocoa: {
    light: { body: '#C4A888', eyes: '#1A1A1A' },
    dark: { body: '#8A7058', eyes: '#F0EEE8' },
  },
  honey: {
    light: { body: '#E8C46A', eyes: '#1A1A1A' },
    dark: { body: '#B89040', eyes: '#1A1A1A' },
  },
  ocean: {
    light: { body: '#7EB8C8', eyes: '#1A1A1A' },
    dark: { body: '#4A8898', eyes: '#F0EEE8' },
  },
  grape: {
    light: { body: '#C4B0E0', eyes: '#1A1A1A' },
    dark: { body: '#8A78B0', eyes: '#1A1A1A' },
  },
  blush: {
    light: { body: '#F0B8C4', eyes: '#1A1A1A' },
    dark: { body: '#C88898', eyes: '#1A1A1A' },
  },
  sand: {
    light: { body: '#E4D4B8', eyes: '#1A1A1A' },
    dark: { body: '#B8A078', eyes: '#1A1A1A' },
  },
  ink: {
    light: { body: '#3A3A42', eyes: '#F0EEE8' },
    dark: { body: '#2A2A30', eyes: '#F0EEE8' },
  },
  ice: {
    light: { body: '#D8EEF2', eyes: '#1A1A1A' },
    dark: { body: '#9AB8C0', eyes: '#1A1A1A' },
  },
  matcha: {
    light: { body: '#B8D4A0', eyes: '#1A1A1A' },
    dark: { body: '#7A9A68', eyes: '#1A1A1A' },
  },
}

export type PresenceOverlays = {
  readonly overlayHat?: string
  readonly overlayGlasses?: string
  readonly overlayHeld?: string
}

/** Durable presence section shared by Face schema and the browser scope. */
export interface PresenceSettings {
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
  stickers: string
  moodId: string
  statusLine: string
  bossNickname: string
  moodAt: number
  statusPresets: string
  titleScheme: PresenceTitleSchemeId
  titleBoss: string
  titleManager: string
  titleAgent: string
}

export const PresenceSettingsSchema: z<PresenceSettings> = z.object({
  [PRESENCE_ENABLED_FIELD]: z.boolean().default(DEFAULT_PRESENCE_ENABLED),
  [PRESENCE_SHAPE_FIELD]: z.union([...PRESENCE_SHAPES]).default(DEFAULT_PRESENCE_SHAPE),
  [PRESENCE_COLOR_FIELD]: z.union([...PRESENCE_COLORS]).default(DEFAULT_PRESENCE_COLOR),
  [PRESENCE_KIT_FIELD]: z.union([...PRESENCE_KITS]).default(DEFAULT_PRESENCE_KIT),
  [PRESENCE_KIT_HAT_FIELD]: z.string().default('none'),
  [PRESENCE_KIT_GLASSES_FIELD]: z.string().default('none'),
  [PRESENCE_KIT_HELD_FIELD]: z.string().default('none'),
  [PRESENCE_OVERLAY_HAT_FIELD]: z.string().default(''),
  [PRESENCE_OVERLAY_GLASSES_FIELD]: z.string().default(''),
  [PRESENCE_OVERLAY_HELD_FIELD]: z.string().default(''),
  [PRESENCE_STICKERS_FIELD]: z.string().default('[]'),
  [PRESENCE_MOOD_ID_FIELD]: z.string().default(DEFAULT_PRESENCE_MOOD_ID),
  [PRESENCE_STATUS_LINE_FIELD]: z.string().default(DEFAULT_PRESENCE_STATUS_LINE),
  [PRESENCE_BOSS_NICKNAME_FIELD]: z.string().default(DEFAULT_PRESENCE_BOSS_NICKNAME),
  [PRESENCE_MOOD_AT_FIELD]: z.number().default(DEFAULT_PRESENCE_MOOD_AT),
  /* Empty = locale factory chips (see resolveStatusPresetsForLocale). */
  [PRESENCE_STATUS_PRESETS_FIELD]: z.string().default('[]'),
  [PRESENCE_TITLE_SCHEME_FIELD]: z.union([...PRESENCE_TITLE_SCHEMES])
    .default(DEFAULT_PRESENCE_TITLE_SCHEME),
  /* Empty = follow scheme × UI locale; non-empty = free-form any language. */
  [PRESENCE_TITLE_BOSS_FIELD]: z.string().default(''),
  [PRESENCE_TITLE_MANAGER_FIELD]: z.string().default(''),
  [PRESENCE_TITLE_AGENT_FIELD]: z.string().default(''),
})

/** Trim + cap Boss nickname for Settings / inject. */
export function parseBossNickname(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PRESENCE_BOSS_NICKNAME
  return raw.trim().slice(0, PRESENCE_BOSS_NICKNAME_MAX)
}

/**
 * Parse tip-chip list from Host `statusPresets` JSON.
 * Empty / invalid → `[]` so the UI can pick locale factory chips via
 * {@link resolveStatusPresetsForLocale}.
 */
export function parseStatusPresets(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const row of parsed) {
      if (typeof row !== 'string') continue
      const tip = row.trim().slice(0, PRESENCE_STATUS_LINE_MAX)
      if (!tip || out.includes(tip)) continue
      out.push(tip)
      if (out.length >= PRESENCE_STATUS_PRESETS_MAX) break
    }
    return out
  } catch {
    return []
  }
}

export function encodeStatusPresets(rows: readonly string[]): string {
  return JSON.stringify(rows.slice(0, PRESENCE_STATUS_PRESETS_MAX))
}

/** Clamp Boss mood id; empty → default focus. */
export function parseMoodId(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PRESENCE_MOOD_ID
  const id = raw.trim()
  return id || DEFAULT_PRESENCE_MOOD_ID
}

export function parseStatusLine(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PRESENCE_STATUS_LINE
  return raw.trim().slice(0, PRESENCE_STATUS_LINE_MAX)
}

/** Canonical raster / SVG sticker data URLs (SVG-as-image; scripts do not run). */
const OVERLAY_RE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i
/** FileReader may emit charset before ;base64, or url-encoded SVG bodies. */
const SVG_BASE64_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?;base64,([A-Za-z0-9+/=]+)$/i
const SVG_XML_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?,(?!;base64)([\s\S]+)$/i

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/** Accept a transparent SVG/PNG (etc.) overlay, or empty to clear. Normalizes FileReader SVG forms. */
export function parsePresenceOverlay(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().replace(/\s+/g, '')
  if (!value) return ''
  if (value.length > PRESENCE_OVERLAY_MAX) return undefined
  if (OVERLAY_RE.test(value)) return value

  const base64Svg = SVG_BASE64_RE.exec(value)
  if (base64Svg?.[1]) {
    const out = `data:image/svg+xml;base64,${base64Svg[1]}`
    return out.length > PRESENCE_OVERLAY_MAX ? undefined : out
  }

  const encoded = SVG_XML_RE.exec(value)
  if (!encoded?.[1]) return undefined
  try {
    const svgText = decodeURIComponent(encoded[1])
    if (!/<svg[\s>/]/i.test(svgText)) return undefined
    const out = `data:image/svg+xml;base64,${textToBase64(svgText)}`
    return out.length > PRESENCE_OVERLAY_MAX ? undefined : out
  } catch {
    return undefined
  }
}

export function isPresenceShape(value: unknown): value is PresenceShape {
  return PRESENCE_SHAPES.some((shape) => shape === value)
}

export function isPresenceColor(value: unknown): value is PresenceColor {
  return PRESENCE_COLORS.some((color) => color === value)
}

export function isPresenceKit(value: unknown): value is PresenceKit {
  return PRESENCE_KITS.some((kit) => kit === value)
}

export function splitLegacyKit(kit: string | undefined): { hat: string; glasses: string } {
  if (!kit || kit === 'none') return { hat: 'none', glasses: 'none' }
  if (kit.startsWith('specs')) return { hat: 'none', glasses: kit }
  return { hat: kit, glasses: 'none' }
}

const STICKER_ID_RE = /^stk_[a-zA-Z0-9]{6,24}$/
const STICKER_PICK_RE = /^sticker:(stk_[a-zA-Z0-9]{6,24})$/

export function stickerRef(id: string): string {
  return `${STICKER_PREFIX}${id}`
}

export function stickerIdFromPick(pick: string): string | undefined {
  const match = STICKER_PICK_RE.exec(pick)
  return match?.[1]
}

export function parseStickers(raw: unknown): PresenceSticker[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      const id = typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : ''
      const image = parsePresenceOverlay((row as { image?: unknown }).image)
      const slotRaw = (row as { slot?: unknown }).slot
      const slot = slotRaw === 'glasses' || slotRaw === 'held' || slotRaw === 'hat' ? slotRaw : 'hat'
      if (!STICKER_ID_RE.test(id) || !image) return []
      return [{ id, image, slot }]
    }).slice(0, PRESENCE_STICKERS_MAX)
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    return parseStickers(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function encodeStickers(rows: readonly PresenceSticker[]): string {
  return JSON.stringify(rows)
}

export function parseSlotPick(raw: unknown, builtins: readonly string[]): string | undefined {
  if (typeof raw !== 'string') return undefined
  const pick = raw.trim()
  if (!pick || pick === 'none') return 'none'
  if (builtins.includes(pick)) return pick
  if (stickerIdFromPick(pick)) return pick
  return undefined
}

export function resolveEnginePick(pick: string, builtins: readonly string[]): string {
  return builtins.includes(pick) && pick !== 'none' ? pick : 'none'
}

export function resolveStickerOverlay(pick: string, stickers: readonly PresenceSticker[]): string {
  const id = stickerIdFromPick(pick)
  if (!id) return ''
  return stickers.find((row) => row.id === id)?.image ?? ''
}

/** Pick body/eye paint for the active chrome scheme. */
export function resolvePresencePaint(
  color: PresenceColor,
  dark: boolean,
): PresencePaint {
  const modes = PRESENCE_COLOR_PALETTES[color] ?? PRESENCE_COLOR_PALETTES[DEFAULT_PRESENCE_COLOR]
  return dark ? modes.dark : modes.light
}
