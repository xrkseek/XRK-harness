/**
 * Live presence prefs: Host `ui-presence` scope + subscribers
 * (PresenceBall remounts when shape / color changes).
 */
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_SHAPE,
  encodeStickers,
  isPresenceColor,
  isPresenceKit,
  isPresenceShape,
  parsePresenceOverlay,
  parseSlotPick,
  parseStickers,
  PRESENCE_COLOR_FIELD,
  PRESENCE_GLASSES_KITS,
  PRESENCE_HAT_KITS,
  PRESENCE_HELD_KITS,
  PRESENCE_KIT_FIELD,
  PRESENCE_KIT_GLASSES_FIELD,
  PRESENCE_KIT_HAT_FIELD,
  PRESENCE_KIT_HELD_FIELD,
  PRESENCE_SHAPE_FIELD,
  PRESENCE_STICKERS_FIELD,
  PRESENCE_STICKERS_MAX,
  resolveEnginePick,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  stickerRef,
  type PresenceColor,
  type PresenceKit,
  type PresenceSettings,
  type PresenceShape,
  type PresenceSticker,
} from '../presence-settings.ts'

export type PresencePrefsListener = () => void
export type DressingSlot = 'hat' | 'glasses' | 'held'

/** Owns persisted companion look and notifies browser listeners. */
export class PresenceSettingsRuntime {
  private shape: PresenceShape = DEFAULT_PRESENCE_SHAPE
  private color: PresenceColor = DEFAULT_PRESENCE_COLOR
  private kit: PresenceKit = DEFAULT_PRESENCE_KIT
  private kitHat = 'none'
  private kitGlasses = 'none'
  private kitHeld = 'none'
  private overlayHat = ''
  private overlayGlasses = ''
  private overlayHeld = ''
  private stickers: PresenceSticker[] = []
  private revision = 0
  private readonly listeners = new Set<PresencePrefsListener>()

  constructor(private readonly host: SettingsScope<PresenceSettings>) {
    this.adopt()
    this.host.subscribe(() => { this.adopt() })
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

  getKitHat(): string {
    return this.kitHat
  }

  getKitGlasses(): string {
    return this.kitGlasses
  }

  getKitHeld(): string {
    return this.kitHeld
  }

  getStickers(): readonly PresenceSticker[] {
    return this.stickers
  }

  getEngineHat(): string {
    return resolveEnginePick(this.kitHat, PRESENCE_HAT_KITS)
  }

  getEngineGlasses(): string {
    return resolveEnginePick(this.kitGlasses, PRESENCE_GLASSES_KITS)
  }

  getEngineHeld(): string {
    return resolveEnginePick(this.kitHeld, PRESENCE_HELD_KITS)
  }

  getOverlayHat(): string {
    return resolveStickerOverlay(this.kitHat, this.stickers)
      || (stickerIdFromPick(this.kitHat) ? '' : this.overlayHat)
  }

  getOverlayGlasses(): string {
    return resolveStickerOverlay(this.kitGlasses, this.stickers)
      || (stickerIdFromPick(this.kitGlasses) ? '' : this.overlayGlasses)
  }

  getOverlayHeld(): string {
    return resolveStickerOverlay(this.kitHeld, this.stickers)
      || (stickerIdFromPick(this.kitHeld) ? '' : this.overlayHeld)
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
    const split = splitLegacyKit(kit)
    this.kit = kit
    this.kitHat = split.hat
    this.kitGlasses = split.glasses
    this.revision += 1
    void this.host.set(PRESENCE_KIT_FIELD, kit)
    void this.host.set(PRESENCE_KIT_HAT_FIELD, split.hat)
    void this.host.set(PRESENCE_KIT_GLASSES_FIELD, split.glasses)
    this.publish()
  }

  setSlot(slot: DressingSlot, pick: string): void {
    const builtins = slot === 'hat'
      ? PRESENCE_HAT_KITS
      : slot === 'glasses'
        ? PRESENCE_GLASSES_KITS
        : PRESENCE_HELD_KITS
    const next = parseSlotPick(pick, builtins)
    if (next === undefined) return
    if (slot === 'hat') {
      if (this.kitHat === next) return
      this.kitHat = next
      void this.host.set(PRESENCE_KIT_HAT_FIELD, next)
    } else if (slot === 'glasses') {
      if (this.kitGlasses === next) return
      this.kitGlasses = next
      void this.host.set(PRESENCE_KIT_GLASSES_FIELD, next)
    } else {
      if (this.kitHeld === next) return
      this.kitHeld = next
      void this.host.set(PRESENCE_KIT_HELD_FIELD, next)
    }
    this.revision += 1
    this.publish()
  }

  addSticker(image: string, slot?: DressingSlot): string | undefined {
    const parsed = parsePresenceOverlay(image)
    if (!parsed) return undefined
    if (this.stickers.length >= PRESENCE_STICKERS_MAX) return undefined
    const id = `stk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
    this.stickers = [...this.stickers, { id, image: parsed, slot: slot ?? 'hat' }]
    this.revision += 1
    void this.host.set(PRESENCE_STICKERS_FIELD, encodeStickers(this.stickers))
    if (slot) this.setSlot(slot, stickerRef(id))
    else this.publish()
    return id
  }

  removeSticker(id: string): void {
    if (!this.stickers.some((row) => row.id === id)) return
    this.stickers = this.stickers.filter((row) => row.id !== id)
    const ref = stickerRef(id)
    if (this.kitHat === ref) {
      this.kitHat = 'none'
      void this.host.set(PRESENCE_KIT_HAT_FIELD, 'none')
    }
    if (this.kitGlasses === ref) {
      this.kitGlasses = 'none'
      void this.host.set(PRESENCE_KIT_GLASSES_FIELD, 'none')
    }
    if (this.kitHeld === ref) {
      this.kitHeld = 'none'
      void this.host.set(PRESENCE_KIT_HELD_FIELD, 'none')
    }
    this.revision += 1
    void this.host.set(PRESENCE_STICKERS_FIELD, encodeStickers(this.stickers))
    this.publish()
  }

  setOverlayHat(value: string): void {
    const id = this.addSticker(value, 'hat')
    if (id === undefined && value.trim() === '') this.setSlot('hat', 'none')
  }

  setOverlayGlasses(value: string): void {
    const id = this.addSticker(value, 'glasses')
    if (id === undefined && value.trim() === '') this.setSlot('glasses', 'none')
  }

  setOverlayHeld(value: string): void {
    const id = this.addSticker(value, 'held')
    if (id === undefined && value.trim() === '') this.setSlot('held', 'none')
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
    const stickers = parseStickers(section?.stickers)
    const split = splitLegacyKit(nextKit)
    const nextHat = parseSlotPick(section?.kitHat, PRESENCE_HAT_KITS) ?? split.hat
    const nextGlasses = parseSlotPick(section?.kitGlasses, PRESENCE_GLASSES_KITS) ?? split.glasses
    const nextHeld = parseSlotPick(section?.kitHeld, PRESENCE_HELD_KITS) ?? 'none'
    const nextOverlayHat = parsePresenceOverlay(section?.overlayHat) ?? ''
    const nextOverlayGlasses = parsePresenceOverlay(section?.overlayGlasses) ?? ''
    const nextOverlayHeld = parsePresenceOverlay(section?.overlayHeld) ?? ''
    if (
      this.shape === nextShape
      && this.color === nextColor
      && this.kit === nextKit
      && this.kitHat === nextHat
      && this.kitGlasses === nextGlasses
      && this.kitHeld === nextHeld
      && this.overlayHat === nextOverlayHat
      && this.overlayGlasses === nextOverlayGlasses
      && this.overlayHeld === nextOverlayHeld
      && encodeStickers(this.stickers) === encodeStickers(stickers)
    ) return
    this.shape = nextShape
    this.color = nextColor
    this.kit = nextKit
    this.kitHat = nextHat
    this.kitGlasses = nextGlasses
    this.kitHeld = nextHeld
    this.overlayHat = nextOverlayHat
    this.overlayGlasses = nextOverlayGlasses
    this.overlayHeld = nextOverlayHeld
    this.stickers = stickers
    this.revision += 1
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
