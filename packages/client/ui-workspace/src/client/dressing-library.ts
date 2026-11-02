/** Shared costume library helpers (Settings `ui-presence` + Agent Team). */

export const PRESENCE_NS = 'ui-presence'
export const STICKER_PREFIX = 'sticker:'
export const PRESENCE_STICKERS_MAX = 24
export const FACE_MAX = 80_000
/* Keep in lockstep with ui-plan PRESENCE_*_KITS — the picker drops anything
 * missing here, so a kit added there but not here is invisible in 干员团队. */
export const HAT_BUILTINS = [
  'none',
  'bow',
  'cap',
  'beanie',
  'bucket',
  'beret',
  'visor',
  'halo',
  'crown',
  'tophat',
  'chef',
  'party',
  'straw',
  'wizard',
  'cat-ears',
  'headphones',
  'antenna',
  'flower-crown',
  'cake',
] as const
export const GLASSES_BUILTINS = [
  'none',
  'specs',
  'specs-rect',
  'specs-cat',
  'specs-sun',
  'specs-round-xl',
  'specs-oval',
  'specs-square',
  'specs-half',
  'specs-rimless',
  'specs-monocle',
  'specs-heart',
  'specs-shades',
] as const
export const HELD_BUILTINS = [
  'none',
  'flower',
  'tea',
  'flag',
  'spark',
  'book',
  'pencil',
  'lamp',
  'umbrella',
  'icecream',
  'guitar',
  'camera',
  'balloon',
  'brand-wechat',
  'brand-qq',
  'brand-douyin',
  'brand-deepseek',
  'brand-bilibili',
  'brand-github',
  'brand-xiaohongshu',
  'brand-taobao',
  'brand-weibo',
  'brand-zhihu',
  'brand-xrk',
] as const

export type DressingSlot = 'hat' | 'glasses' | 'held'
export type DressingSticker = {
  readonly id: string
  readonly image: string
  readonly slot: DressingSlot
}

/** Canonical raster / SVG sticker data URLs (SVG-as-image; scripts do not run). */
const OVERLAY_RE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i
/** FileReader may emit charset before ;base64, or url-encoded SVG bodies. */
const SVG_BASE64_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?;base64,([A-Za-z0-9+/=]+)$/i
const SVG_XML_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?,(?!;base64)([\s\S]+)$/i
const STICKER_ID_RE = /^stk_[a-zA-Z0-9]{6,24}$/
const STICKER_PICK_RE = /^sticker:(stk_[a-zA-Z0-9]{6,24})$/

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/** Accept a transparent SVG/PNG (etc.) overlay, or empty to clear. Normalizes FileReader SVG forms. */
export function parseOverlayImage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().replace(/\s+/g, '')
  if (!value) return ''
  if (value.length > FACE_MAX) return undefined
  if (OVERLAY_RE.test(value)) return value

  const base64Svg = SVG_BASE64_RE.exec(value)
  if (base64Svg?.[1]) {
    const out = `data:image/svg+xml;base64,${base64Svg[1]}`
    return out.length > FACE_MAX ? undefined : out
  }

  const encoded = SVG_XML_RE.exec(value)
  if (!encoded?.[1]) return undefined
  try {
    const svgText = decodeURIComponent(encoded[1])
    if (!/<svg[\s>/]/i.test(svgText)) return undefined
    const out = `data:image/svg+xml;base64,${textToBase64(svgText)}`
    return out.length > FACE_MAX ? undefined : out
  } catch {
    return undefined
  }
}

export function splitLegacyKit(kit: string | undefined): { hat: string; glasses: string } {
  if (!kit || kit === 'none') return { hat: 'none', glasses: 'none' }
  if (kit.startsWith('specs')) return { hat: 'none', glasses: kit }
  return { hat: kit, glasses: 'none' }
}

export function stickerRef(id: string): string {
  return `${STICKER_PREFIX}${id}`
}

export function stickerIdFromPick(pick: string): string | undefined {
  return STICKER_PICK_RE.exec(pick)?.[1]
}

function parseDressingSlot(raw: unknown): DressingSlot | undefined {
  return raw === 'hat' || raw === 'glasses' || raw === 'held' ? raw : undefined
}

export function parseStickers(raw: unknown): DressingSticker[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      const id = typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : ''
      const image = parseOverlayImage((row as { image?: unknown }).image)
      const slot = parseDressingSlot((row as { slot?: unknown }).slot) ?? 'hat'
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

export function encodeStickers(rows: readonly DressingSticker[]): string {
  return JSON.stringify(rows)
}

export function parseSlotPick(raw: unknown, builtins: readonly string[]): string {
  if (typeof raw !== 'string') return 'none'
  const pick = raw.trim()
  if (!pick || pick === 'none') return 'none'
  if (builtins.includes(pick)) return pick
  if (stickerIdFromPick(pick)) return pick
  return 'none'
}

export function resolveEnginePick(pick: string, builtins: readonly string[]): string {
  return builtins.includes(pick) && pick !== 'none' ? pick : 'none'
}

export function resolveStickerOverlay(pick: string, stickers: readonly DressingSticker[]): string {
  const id = stickerIdFromPick(pick)
  if (!id) return ''
  return stickers.find((row) => row.id === id)?.image ?? ''
}

export function stickersForSlot(
  rows: readonly DressingSticker[],
  slot: DressingSlot,
): readonly DressingSticker[] {
  return rows.filter((row) => row.slot === slot)
}

/* ---- Companion look vocabulary: the single source of truth ----------------
 * Shapes / colors / kits / palettes used by the ball engine, the 干员团队
 * pickers and dressing-scope validation. Nothing may hand-copy these lists:
 * a stale copy silently filters new ids back to `none` (the crown/cake bug).
 * ------------------------------------------------------------------------ */
export const COMPANION_SHAPES = [
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
  'capsule',
  'oval',
  'tri',
  'diamond',
  'octagon',
  'pentagon',
  'cross',
  'cushion',
  'bean',
  'peanut',
  'leaf',
  'arrow',
  'bolt',
  'cup',
  'shield-tall',
  'hex-soft',
  'gear',
  'star4',
  'star6',
  'heart-soft',
  'cloud-puff',
  'teardrop',
  'quatrefoil',
  'flower5',
  'crescent',
  'bowtie',
] as const

export const COMPANION_COLORS = [
  /* ---- 基础 ---- */
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
  /* ---- 金属 / 暗色 ---- */
  'gold',
  'silver',
  'copper',
  'midnight',
  'frost',
  'ember',
  'twilight',
  /* ---- 中性 / 大地 ---- */
  'clay',
  'linen',
  'oat',
  'stone',
  'fog',
  'ash',
  /* ---- 玉 ---- */
  'jade',
] as const

export const COMPANION_KITS = [
  'none',
  'bow',
  'cap',
  'beanie',
  'bucket',
  'beret',
  'visor',
  'halo',
  'crown',
  'tophat',
  'chef',
  'party',
  'straw',
  'wizard',
  'cat-ears',
  'headphones',
  'antenna',
  'flower-crown',
  'cake',
  'specs',
  'specs-rect',
  'specs-cat',
  'specs-sun',
  'specs-round-xl',
  'specs-oval',
  'specs-square',
  'specs-half',
  'specs-rimless',
  'specs-monocle',
  'specs-heart',
  'specs-shades',
] as const

export type CompanionShape = (typeof COMPANION_SHAPES)[number]
export type CompanionColor = (typeof COMPANION_COLORS)[number]
export type CompanionKit = (typeof COMPANION_KITS)[number]
export type CompanionHeld = (typeof HELD_BUILTINS)[number]

export function isHeldBuiltin(value: string): value is Exclude<CompanionHeld, 'none'> {
  return value !== 'none' && (HELD_BUILTINS as readonly string[]).includes(value)
}

const PALETTES: Record<CompanionColor, { light: { body: string; eyes: string }; dark: { body: string; eyes: string } }> = {
  cream: { light: { body: '#F3F0EA', eyes: '#1A1A1A' }, dark: { body: '#E4E0D8', eyes: '#1A1A1A' } },
  mist: { light: { body: '#D4E0EC', eyes: '#1A1A1A' }, dark: { body: '#9AABB8', eyes: '#1A1A1A' } },
  peach: { light: { body: '#F0D8C8', eyes: '#1A1A1A' }, dark: { body: '#C4A090', eyes: '#1A1A1A' } },
  sage: { light: { body: '#D4E5C8', eyes: '#1A1A1A' }, dark: { body: '#96B088', eyes: '#1A1A1A' } },
  lilac: { light: { body: '#E5D4E8', eyes: '#1A1A1A' }, dark: { body: '#B098B8', eyes: '#1A1A1A' } },
  slate: { light: { body: '#C8CDD4', eyes: '#1A1A1A' }, dark: { body: '#5A6068', eyes: '#F0EEE8' } },
  coral: { light: { body: '#F0C8BC', eyes: '#1A1A1A' }, dark: { body: '#C48A7C', eyes: '#1A1A1A' } },
  butter: { light: { body: '#F2E4B0', eyes: '#1A1A1A' }, dark: { body: '#C4B070', eyes: '#1A1A1A' } },
  mint: { light: { body: '#C8E8DC', eyes: '#1A1A1A' }, dark: { body: '#7ABAA8', eyes: '#1A1A1A' } },
  sky: { light: { body: '#C5DCF0', eyes: '#1A1A1A' }, dark: { body: '#7A9BB8', eyes: '#1A1A1A' } },
  rose: { light: { body: '#E8C8D4', eyes: '#1A1A1A' }, dark: { body: '#B8889C', eyes: '#1A1A1A' } },
  cocoa: { light: { body: '#C4A888', eyes: '#1A1A1A' }, dark: { body: '#8A7058', eyes: '#F0EEE8' } },
  honey: { light: { body: '#E8C46A', eyes: '#1A1A1A' }, dark: { body: '#B89040', eyes: '#1A1A1A' } },
  ocean: { light: { body: '#7EB8C8', eyes: '#1A1A1A' }, dark: { body: '#4A8898', eyes: '#F0EEE8' } },
  clay: { light: { body: '#D9B8A0', eyes: '#1A1A1A' }, dark: { body: '#A8805F', eyes: '#1A1A1A' } },
  linen: { light: { body: '#EDE4D4', eyes: '#1A1A1A' }, dark: { body: '#C4B49C', eyes: '#1A1A1A' } },
  oat: { light: { body: '#E8DCC0', eyes: '#1A1A1A' }, dark: { body: '#BCAA88', eyes: '#1A1A1A' } },
  stone: { light: { body: '#CFCAC2', eyes: '#1A1A1A' }, dark: { body: '#8A857C', eyes: '#F0EEE8' } },
  ash: { light: { body: '#C6C4C0', eyes: '#1A1A1A' }, dark: { body: '#7A7A78', eyes: '#F0EEE8' } },
  fog: { light: { body: '#DCE2E0', eyes: '#1A1A1A' }, dark: { body: '#9AAAA6', eyes: '#1A1A1A' } },
  jade: { light: { body: '#8FD2AE', eyes: '#1A1A1A' }, dark: { body: '#4E9470', eyes: '#F0EEE8' } },
  gold: { light: { body: '#E8C86A', eyes: '#1A1A1A' }, dark: { body: '#B08E33', eyes: '#1A1A1A' } },
  silver: { light: { body: '#D9DEE4', eyes: '#1A1A1A' }, dark: { body: '#9AA4AE', eyes: '#1A1A1A' } },
  copper: { light: { body: '#D89A70', eyes: '#1A1A1A' }, dark: { body: '#A4663C', eyes: '#F0EEE8' } },
  midnight: { light: { body: '#4E5A80', eyes: '#F0EEE8' }, dark: { body: '#333D5C', eyes: '#F0EEE8' } },
  frost: { light: { body: '#E4F0F4', eyes: '#1A1A1A' }, dark: { body: '#ADC6CC', eyes: '#1A1A1A' } },
  ember: { light: { body: '#E08A5E', eyes: '#1A1A1A' }, dark: { body: '#A85A34', eyes: '#F0EEE8' } },
  twilight: { light: { body: '#9A8AC2', eyes: '#1A1A1A' }, dark: { body: '#6A5C92', eyes: '#F0EEE8' } },
}

export function isCompanionShape(value: string): value is CompanionShape {
  return COMPANION_SHAPES.some((id) => id === value)
}

export function isCompanionColor(value: string): value is CompanionColor {
  return COMPANION_COLORS.some((id) => id === value)
}

export function isCompanionKit(value: string): value is CompanionKit {
  return COMPANION_KITS.some((id) => id === value)
}

export function companionPaint(color: string, dark: boolean): { body: string; eyes: string } {
  const id = isCompanionColor(color) ? color : 'cream'
  return dark ? PALETTES[id].dark : PALETTES[id].light
}
