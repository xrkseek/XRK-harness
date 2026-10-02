import { en } from './locales.ts'

/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** Machine value of the experimental current-session Auto review preset. */
export const AUTO_REVIEW_PRESET = 'auto'

/** Known Face / protocol permission preset ids (DSH + Auto). */
export const PERMISSION_PRESET_IDS = [
  'read-only',
  'workspace-write',
  'danger-full-access',
  AUTO_REVIEW_PRESET,
] as const

export type PermissionPresetId = (typeof PERMISSION_PRESET_IDS)[number]

/** Locale dictionary key for a built-in permission preset label. */
export type PermissionPresetLabelKey =
  | 'preset.readOnly'
  | 'preset.workspaceWrite'
  | 'preset.fullAccess'
  | 'preset.auto'

const PRESET_LABEL_KEYS = new Map<string, PermissionPresetLabelKey>([
  ['read-only', 'preset.readOnly'],
  ['workspace-write', 'preset.workspaceWrite'],
  [FULL_ACCESS_PRESET, 'preset.fullAccess'],
  [AUTO_REVIEW_PRESET, 'preset.auto'],
])

const DEFAULT_PRESET_LABELS: Record<PermissionPresetLabelKey, string> = {
  'preset.readOnly': en['preset.readOnly'],
  'preset.workspaceWrite': en['preset.workspaceWrite'],
  'preset.fullAccess': en['preset.fullAccess'],
  'preset.auto': en['preset.auto'],
}

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - optional locale dictionary lookup for built-in product labels.
 * @returns the built-in product label or the conventional display name.
 */
export function displayPermissionPreset(
  value: string,
  name: string,
  t?: (key: PermissionPresetLabelKey) => string,
): string {
  const key = PRESET_LABEL_KEYS.get(value)
  // Built-in presets always render under the active locale's product label.
  // The Host descriptor ships English names ("Read only"), and those must not
  // leak into a Chinese UI — only custom (host-authored) presets keep their
  // supplied label.
  if (key !== undefined) return t?.(key) ?? DEFAULT_PRESET_LABELS[key]
  return displayPresetName(name)
}

/** Whether `value` is the Full access preset that needs a risk gate. */
export function isFullAccessPreset(value: string): boolean {
  return value === FULL_ACCESS_PRESET
}

/** Whether `value` is the experimental Auto review preset that needs a risk gate. */
export function isAutoPreset(value: string): boolean {
  return value === AUTO_REVIEW_PRESET
}
