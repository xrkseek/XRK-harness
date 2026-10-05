/**
 * Live presence prefs: Host `ui-presence` scope + subscribers
 * (PresenceBall remounts when shape / color changes).
 */
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_SHAPE,
  isPresenceColor,
  isPresenceKit,
  isPresenceShape,
  PRESENCE_COLOR_FIELD,
  PRESENCE_KIT_FIELD,
  PRESENCE_SHAPE_FIELD,
  type PresenceColor,
  type PresenceKit,
  type PresenceSettings,
  type PresenceShape,
} from '../presence-settings.ts'

export type PresencePrefsListener = () => void

/** Owns persisted companion shape + color and notifies browser listeners. */
export class PresenceSettingsRuntime {
  private shape: PresenceShape = DEFAULT_PRESENCE_SHAPE
  private color: PresenceColor = DEFAULT_PRESENCE_COLOR
  private kit: PresenceKit = DEFAULT_PRESENCE_KIT
  private revision = 0
  private readonly listeners = new Set<PresencePrefsListener>()

  constructor(private readonly host: SettingsScope<PresenceSettings>) {
    this.adopt()
    this.host.subscribe(() => { this.adopt() })
    void this.host.load()
  }

  getShape(): PresenceShape {
    return this.shape
  }

  getColor(): PresenceColor {
    return this.color
  }

  getKit(): PresenceKit {
    return this.kit
  }

  getRevision(): number {
    return this.revision
  }

  setShape(shape: PresenceShape): void {
    if (!isPresenceShape(shape)) return
    if (this.shape === shape) return
    this.shape = shape
    this.revision += 1
    void this.host.set(PRESENCE_SHAPE_FIELD, shape)
    this.publish()
  }

  setColor(color: PresenceColor): void {
    if (!isPresenceColor(color)) return
    if (this.color === color) return
    this.color = color
    this.revision += 1
    void this.host.set(PRESENCE_COLOR_FIELD, color)
    this.publish()
  }

  setKit(kit: PresenceKit): void {
    if (!isPresenceKit(kit)) return
    if (this.kit === kit) return
    this.kit = kit
    this.revision += 1
    void this.host.set(PRESENCE_KIT_FIELD, kit)
    this.publish()
  }

  subscribe(listener: PresencePrefsListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private adopt(): void {
    const section = this.host.getSnapshot().value
    const nextShape = isPresenceShape(section?.shape)
      ? section.shape
      : DEFAULT_PRESENCE_SHAPE
    const nextColor = isPresenceColor(section?.color)
      ? section.color
      : DEFAULT_PRESENCE_COLOR
    const nextKit = isPresenceKit(section?.kit)
      ? section.kit
      : DEFAULT_PRESENCE_KIT
    if (this.shape === nextShape && this.color === nextColor && this.kit === nextKit) return
    this.shape = nextShape
    this.color = nextColor
    this.kit = nextKit
    this.revision += 1
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
