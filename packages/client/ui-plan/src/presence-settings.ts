/** Presence companion preferences in the Host user-settings document. */

import z from '@xrkseek/schemastery'

/** Body shapes shipped in apps/web/public/presence/emotion-ball. */
export const PRESENCE_SHAPES = ['blob', 'wedge', 'gem'] as const

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
] as const

/** Settings namespace owned by the ui-plan presence surface. */
export const PRESENCE_SETTINGS_NAMESPACE = 'ui-presence'

export const PRESENCE_SHAPE_FIELD = 'shape'
export const PRESENCE_COLOR_FIELD = 'color'

export type PresenceShape = (typeof PRESENCE_SHAPES)[number]
export type PresenceColor = (typeof PRESENCE_COLORS)[number]

export const DEFAULT_PRESENCE_SHAPE: PresenceShape = 'blob'
/** Matches emotion-ball idle body (`#F3F0EA`), not pure white. */
export const DEFAULT_PRESENCE_COLOR: PresenceColor = 'cream'

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
}

/** Durable presence section shared by Face schema and the browser scope. */
export interface PresenceSettings {
  shape: PresenceShape
  color: PresenceColor
}

export const PresenceSettingsSchema: z<PresenceSettings> = z.object({
  [PRESENCE_SHAPE_FIELD]: z.union([...PRESENCE_SHAPES]).default(DEFAULT_PRESENCE_SHAPE),
  [PRESENCE_COLOR_FIELD]: z.union([...PRESENCE_COLORS]).default(DEFAULT_PRESENCE_COLOR),
})

export function isPresenceShape(value: unknown): value is PresenceShape {
  return PRESENCE_SHAPES.some((shape) => shape === value)
}

export function isPresenceColor(value: unknown): value is PresenceColor {
  return PRESENCE_COLORS.some((color) => color === value)
}

/** Pick body/eye paint for the active chrome scheme. */
export function resolvePresencePaint(
  color: PresenceColor,
  dark: boolean,
): PresencePaint {
  const modes = PRESENCE_COLOR_PALETTES[color] ?? PRESENCE_COLOR_PALETTES[DEFAULT_PRESENCE_COLOR]
  return dark ? modes.dark : modes.light
}
