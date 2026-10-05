/** Host `ui-presence` sticker library shared by Agent Team and Settings. */
import { useSyncExternalStore } from 'react'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  encodeStickers,
  parseSlotPick,
  parseStickers,
  PRESENCE_NS,
  PRESENCE_STICKERS_MAX,
  parseOverlayImage,
  stickerIdFromPick,
  stickerRef,
  type DressingSlot,
  type DressingSticker,
} from './dressing-library.ts'

type PresenceNs = {
  readonly stickers?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
}

const EMPTY_STICKERS: readonly DressingSticker[] = []

let host: SettingsScope<PresenceNs> | undefined
let stickersCache: { readonly raw: unknown; readonly rows: readonly DressingSticker[] } | undefined

function readStickers(): readonly DressingSticker[] {
  if (!host) {
    stickersCache = undefined
    return EMPTY_STICKERS
  }
  const raw = host.getSnapshot().value?.stickers
  if (stickersCache && Object.is(stickersCache.raw, raw)) return stickersCache.rows
  const parsed = parseStickers(raw)
  const rows = parsed.length === 0 ? EMPTY_STICKERS : parsed
  stickersCache = { raw, rows }
  return rows
}

export function bindDressingHost(scope: SettingsScope<PresenceNs>): void {
  host = scope
  stickersCache = undefined
}

export function useDressingStickers(): readonly DressingSticker[] {
  return useSyncExternalStore(
    (onStoreChange) => host?.subscribe(onStoreChange) ?? (() => {}),
    readStickers,
    () => EMPTY_STICKERS,
  )
}

export function addDressingSticker(image: string, slot: DressingSlot): string | undefined {
  const parsed = parseOverlayImage(image)
  if (!parsed || !host) return undefined
  const rows = readStickers()
  if (rows.length >= PRESENCE_STICKERS_MAX) return undefined
  const id = `stk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
  void host.set('stickers', encodeStickers([...rows, { id, image: parsed, slot }]))
  return id
}

export function removeDressingSticker(id: string): void {
  if (!host) return
  const section = host.getSnapshot().value
  const rows = readStickers().filter((row) => row.id !== id)
  const ref = stickerRef(id)
  void host.set('stickers', encodeStickers(rows))
  if (parseSlotPick(section?.kitHat, []) === ref) void host.set('kitHat', 'none')
  if (parseSlotPick(section?.kitGlasses, []) === ref) void host.set('kitGlasses', 'none')
  if (parseSlotPick(section?.kitHeld, []) === ref) void host.set('kitHeld', 'none')
}

export { PRESENCE_NS, stickerIdFromPick, stickerRef }
