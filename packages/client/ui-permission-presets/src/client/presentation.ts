/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** Known Face / protocol permission preset ids (DSH + Codex three-way). */
export const PERMISSION_PRESET_IDS = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export type PermissionPresetId = (typeof PERMISSION_PRESET_IDS)[number]

/** Product labels — keep composer chip and Settings row consistent. */
const PRODUCT_LABEL_EN: Record<PermissionPresetId, string> = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
  'danger-full-access': 'Full access',
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
 * Render a permission preset under its product label (English default).
 * Locale surfaces may override via their own dictionaries.
 * @param value - preset machine value.
 * @param name - host-supplied preset name (fallback when unknown).
 * @returns product label for known presets, else title-cased name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  if (value in PRODUCT_LABEL_EN) {
    return PRODUCT_LABEL_EN[value as PermissionPresetId]
  }
  return displayPresetName(name)
}

/** Whether `value` is the Full access preset that needs a risk gate. */
export function isFullAccessPreset(value: string): boolean {
  return value === FULL_ACCESS_PRESET
}
