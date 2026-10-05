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
}

export const PresenceSettingsSchema: z<PresenceSettings> = z.object({
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
})

const OVERLAY_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i

/** Accept a transparent PNG (etc.) overlay, or empty to clear. */
export function parsePresenceOverlay(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().replace(/\s+/g, '')
  if (!value) return ''
  if (value.length > PRESENCE_OVERLAY_MAX || !OVERLAY_RE.test(value)) return undefined
  return value
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
