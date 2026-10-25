/**
 * Product icon surface.
 *
 * The set is DSH's: one artwork table (`artwork.ts`), one `<symbol>` per glyph
 * and stroke weight in the document sprite that `ui-theme` mounts, and thin
 * components that render `<use href="#dsw-icon-<glyph>-<weight>">`. A theme can
 * therefore replace any glyph without a call site changing, and the artwork
 * inherits `currentColor` plus CSS variables where it is used.
 *
 * The 74 hand-written fill-style figma extracts (`IconXxx16`, `IconApiOutline14`,
 * …) that used to live in this file are gone: every call site now imports the
 * weighted `IconXxxRegular` name, so the inline-path copies were dead markup
 * that would have drifted from the product set. The one glyph DSH does not ship
 * — `bell-outline` — was added to `artwork.ts` instead of keeping a second icon
 * system alive for a single bell.
 */
export type { IconProps } from './props.ts'

export * from './product-icons.tsx'
export {
  ICON_ARTWORK, ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE, ICON_SYMBOLS,
  iconSymbolId, type IconGlyph, type IconSymbolId, type IconWeight,
} from './artwork.ts'
