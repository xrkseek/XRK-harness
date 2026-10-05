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

/** Durable presence section shared by Face schema and the browser scope. */
export interface PresenceSettings {
  shape: PresenceShape
  color: PresenceColor
  kit: PresenceKit
}

export const PresenceSettingsSchema: z<PresenceSettings> = z.object({
  [PRESENCE_SHAPE_FIELD]: z.union([...PRESENCE_SHAPES]).default(DEFAULT_PRESENCE_SHAPE),
  [PRESENCE_COLOR_FIELD]: z.union([...PRESENCE_COLORS]).default(DEFAULT_PRESENCE_COLOR),
  [PRESENCE_KIT_FIELD]: z.union([...PRESENCE_KITS]).default(DEFAULT_PRESENCE_KIT),
})

export function isPresenceShape(value: unknown): value is PresenceShape {
  return PRESENCE_SHAPES.some((shape) => shape === value)
}

export function isPresenceColor(value: unknown): value is PresenceColor {
  return PRESENCE_COLORS.some((color) => color === value)
}

export function isPresenceKit(value: unknown): value is PresenceKit {
  return PRESENCE_KITS.some((kit) => kit === value)
}

/** Pick body/eye paint for the active chrome scheme. */
export function resolvePresencePaint(
  color: PresenceColor,
  dark: boolean,
): PresencePaint {
  const modes = PRESENCE_COLOR_PALETTES[color] ?? PRESENCE_COLOR_PALETTES[DEFAULT_PRESENCE_COLOR]
  return dark ? modes.dark : modes.light
}
