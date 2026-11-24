/**
 * Shared companion-ball look shape (Face `companionBall` / look cache / live merge).
 * Keep field lists in lockstep with Face `AppearanceLookWire`.
 *
 * Named `PresenceLookSnapshot` (not `PresenceLook`) so it does not collide with
 * Settings boss look in `presence-settings.ts`.
 */
export type PresenceLookSnapshot = {
  readonly shape: string
  readonly color: string
  readonly bodyColor?: string
  readonly eyeColor?: string
  readonly size?: number
  readonly kit?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
  readonly overlayHat?: string
  readonly overlayGlasses?: string
  readonly overlayHeld?: string
}

/** True when shape+color are non-empty (paintable). */
export function isPresenceLookSnapshot(value: unknown): value is PresenceLookSnapshot {
  if (!value || typeof value !== 'object') return false
  const shape = (value as { shape?: unknown }).shape
  const color = (value as { color?: unknown }).color
  return typeof shape === 'string' && shape.length > 0
    && typeof color === 'string' && color.length > 0
}
