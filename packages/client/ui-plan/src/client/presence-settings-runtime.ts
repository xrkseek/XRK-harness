/**
 * Live presence prefs: Host `ui-presence` scope + subscribers
 * (PresenceBall remounts when the look changes).
 *
 * Read side: the whole companion look. Write side: only what the Plugins card
 * owns — the master switch, seat titles, and status tip presets. Appearance is
 * written by 干员团队 through its own scope (`dressing-scope.ts`), so there is
 * exactly one UI per field and no second copy of the same control here.
 */
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_ENABLED,
  DEFAULT_PRESENCE_KIT,
  DEFAULT_PRESENCE_BOSS_NICKNAME,
  DEFAULT_PRESENCE_MOOD_AT,
  DEFAULT_PRESENCE_MOOD_ID,
  DEFAULT_PRESENCE_SHAPE,
  DEFAULT_PRESENCE_STATUS_LINE,
  DEFAULT_PRESENCE_TITLE_SCHEME,
  encodeStatusPresets,
  encodeStickers,
  isPresenceColor,
  isPresenceKit,
  isPresenceShape,
  parseBossNickname,
  parseHexColor,
  parsePresenceSize,
  parseMoodId,
  parsePresenceOverlay,
  parseSeatTitle,
  parseSlotPick,
  parseStatusLine,
  parseStatusPresets,
  parseStickers,
  parseTitleScheme,
  PRESENCE_BOSS_NICKNAME_FIELD,
  PRESENCE_ENABLED_FIELD,
  PRESENCE_GLASSES_KITS,
  PRESENCE_HAT_KITS,
  PRESENCE_HELD_KITS,
  DEFAULT_PRESENCE_SIZE,
  PRESENCE_MOOD_AT_FIELD,
  PRESENCE_MOOD_ID_FIELD,
  PRESENCE_STATUS_LINE_FIELD,
  PRESENCE_STATUS_LINE_MAX,
  PRESENCE_STATUS_PRESETS_FIELD,
  PRESENCE_STATUS_PRESETS_MAX,
  PRESENCE_TITLE_AGENT_FIELD,
  PRESENCE_TITLE_BOSS_FIELD,
  PRESENCE_TITLE_MANAGER_FIELD,
  PRESENCE_TITLE_SCHEME_FIELD,
  resolveEnginePick,
  resolveSeatTitles,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  type PresenceColor,
  type PresenceKit,
  type PresenceSeatTitles,
  type PresenceSettings,
  type PresenceShape,
  type PresenceSticker,
  type PresenceTitleLocale,
  type PresenceTitleSchemeId,
} from '../presence-settings.ts'

export type PresencePrefsListener = () => void

/** Owns persisted companion look and notifies browser listeners. */
export class PresenceSettingsRuntime {
  private enabled = DEFAULT_PRESENCE_ENABLED
  private shape: PresenceShape = DEFAULT_PRESENCE_SHAPE
  private color: PresenceColor = DEFAULT_PRESENCE_COLOR
  /** Empty = follow the named preset; otherwise the operator's own hex. */
  private bodyColor = ''
  private size = DEFAULT_PRESENCE_SIZE
  private eyeColor = ''
  private kit: PresenceKit = DEFAULT_PRESENCE_KIT
  private kitHat = 'none'
  private kitGlasses = 'none'
  private kitHeld = 'none'
  private overlayHat = ''
  private overlayGlasses = ''
  private overlayHeld = ''
  private stickers: PresenceSticker[] = []
  private moodId = DEFAULT_PRESENCE_MOOD_ID
  private statusLine = DEFAULT_PRESENCE_STATUS_LINE
  private bossNickname = DEFAULT_PRESENCE_BOSS_NICKNAME
  private moodAt = DEFAULT_PRESENCE_MOOD_AT
  private statusPresets: string[] = parseStatusPresets(undefined)
  private titleScheme: PresenceTitleSchemeId = DEFAULT_PRESENCE_TITLE_SCHEME
  /** Empty = follow scheme × UI locale; non-empty = free-form any language. */
  private titleBoss = ''
  private titleManager = ''
  private titleAgent = ''
  private revision = 0
  private readonly listeners = new Set<PresencePrefsListener>()

  constructor(private readonly host: SettingsScope<PresenceSettings>) {
    this.adopt()
    this.host.subscribe(() => { this.adopt() })
  }

  /** When false, header dock and Overview rail hide the ball. */
  getEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.revision += 1
    void this.host.set(PRESENCE_ENABLED_FIELD, enabled)
    this.publish()
  }

  getShape(): PresenceShape {
    return this.shape
  }

  getColor(): PresenceColor {
    return this.color
  }

  /** Ball size multiplier; ''-style fallback does not apply (1 = default). */
  getSize(): number {
    return this.size
  }

  /** Free-form body hex; '' means "follow the named preset". */
  getBodyColor(): string {
    return this.bodyColor
  }

  /** Free-form eye hex; '' means "follow the named preset". */
  getEyeColor(): string {
    return this.eyeColor
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

  /** Boss Overview seat emotion id (operator work mood). */
  getMoodId(): string {
    return this.moodId
  }

  getStatusLine(): string {
    return this.statusLine
  }

  getBossNickname(): string {
    return this.bossNickname
  }

  getMoodAt(): number {
    return this.moodAt
  }

  getStatusPresets(): readonly string[] {
    return this.statusPresets
  }

  getTitleScheme(): PresenceTitleSchemeId {
    return this.titleScheme
  }

  getTitleBoss(): string {
    return this.titleBoss
  }

  getTitleManager(): string {
    return this.titleManager
  }

  getTitleAgent(): string {
    return this.titleAgent
  }

  getSeatTitles(locale: PresenceTitleLocale = 'zh'): PresenceSeatTitles {
    return resolveSeatTitles({
      titleScheme: this.titleScheme,
      titleBoss: this.titleBoss,
      titleManager: this.titleManager,
      titleAgent: this.titleAgent,
      locale,
    })
  }

  /** Pick a built-in preset; clears custom fields so copy follows UI locale. */
  setTitleScheme(scheme: PresenceTitleSchemeId): void {
    const next = parseTitleScheme(scheme)
    if (
      this.titleScheme === next
      && !this.titleBoss
      && !this.titleManager
      && !this.titleAgent
    ) return
    this.titleScheme = next
    this.titleBoss = ''
    this.titleManager = ''
    this.titleAgent = ''
    this.revision += 1
    void this.host.set(PRESENCE_TITLE_SCHEME_FIELD, this.titleScheme)
    void this.host.set(PRESENCE_TITLE_BOSS_FIELD, '')
    void this.host.set(PRESENCE_TITLE_MANAGER_FIELD, '')
    void this.host.set(PRESENCE_TITLE_AGENT_FIELD, '')
    this.publish()
  }

  /** Free-form seat title (any language); empty restores the preset for that seat. */
  setSeatTitle(seat: 'boss' | 'manager' | 'agent', raw: string): void {
    const next = parseSeatTitle(raw)
    if (seat === 'boss') {
      if (this.titleBoss === next) return
      this.titleBoss = next
      void this.host.set(PRESENCE_TITLE_BOSS_FIELD, this.titleBoss)
    } else if (seat === 'manager') {
      if (this.titleManager === next) return
      this.titleManager = next
      void this.host.set(PRESENCE_TITLE_MANAGER_FIELD, this.titleManager)
    } else {
      if (this.titleAgent === next) return
      this.titleAgent = next
      void this.host.set(PRESENCE_TITLE_AGENT_FIELD, this.titleAgent)
    }
    this.revision += 1
    this.publish()
  }

  setMood(moodId: string, statusLine?: string): void {
    const nextMood = parseMoodId(moodId)
    const nextLine = statusLine === undefined
      ? this.statusLine
      : parseStatusLine(statusLine)
    if (this.moodId === nextMood && this.statusLine === nextLine) return
    this.moodId = nextMood
    this.statusLine = nextLine
    this.moodAt = Date.now()
    this.revision += 1
    void this.host.patch([
      { op: 'set', path: [PRESENCE_MOOD_ID_FIELD], value: this.moodId },
      { op: 'set', path: [PRESENCE_STATUS_LINE_FIELD], value: this.statusLine },
      { op: 'set', path: [PRESENCE_MOOD_AT_FIELD], value: this.moodAt },
    ])
    this.publish()
  }

  setStatusLine(statusLine: string): void {
    const next = parseStatusLine(statusLine)
    if (this.statusLine === next) return
    this.statusLine = next
    this.moodAt = Date.now()
    this.revision += 1
    void this.host.patch([
      { op: 'set', path: [PRESENCE_STATUS_LINE_FIELD], value: this.statusLine },
      { op: 'set', path: [PRESENCE_MOOD_AT_FIELD], value: this.moodAt },
    ])
    this.publish()
  }

  setBossNickname(nickname: string): void {
    const next = parseBossNickname(nickname)
    if (this.bossNickname === next) return
    this.bossNickname = next
    this.revision += 1
    void this.host.set(PRESENCE_BOSS_NICKNAME_FIELD, this.bossNickname)
    this.publish()
  }

  setStatusPresets(presets: readonly string[]): void {
    const next: string[] = []
    for (const row of presets) {
      const tip = row.trim().slice(0, PRESENCE_STATUS_LINE_MAX)
      if (!tip || next.includes(tip)) continue
      next.push(tip)
      if (next.length >= PRESENCE_STATUS_PRESETS_MAX) break
    }
    if (encodeStatusPresets(this.statusPresets) === encodeStatusPresets(next)) return
    this.statusPresets = next
    this.revision += 1
    void this.host.set(PRESENCE_STATUS_PRESETS_FIELD, encodeStatusPresets(next))
    this.publish()
  }

  addStatusPreset(tip: string): boolean {
    const next = parseStatusLine(tip)
    if (!next) return false
    if (this.statusPresets.includes(next)) return false
    if (this.statusPresets.length >= PRESENCE_STATUS_PRESETS_MAX) return false
    this.setStatusPresets([...this.statusPresets, next])
    return true
  }

  removeStatusPreset(tip: string): void {
    const target = tip.trim()
    if (!target) return
    this.setStatusPresets(this.statusPresets.filter((row) => row !== target))
  }

  // The look itself (shape / preset color / custom colors / size / kit /
  // stickers) is written by 干员团队 through its own Host scope — see
  // `ui-workspace/src/client/dressing-scope.ts`. This runtime is the read side
  // for the ball plus the write side for what the Plugins card owns, so no
  // duplicate appearance setters live here.

  subscribe(listener: PresencePrefsListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private adopt(): void {
    const section = this.host.getSnapshot().value
    const nextEnabled = typeof section?.enabled === 'boolean'
      ? section.enabled
      : DEFAULT_PRESENCE_ENABLED
    const nextShape = isPresenceShape(section?.shape)
      ? section.shape
      : DEFAULT_PRESENCE_SHAPE
    const nextColor = isPresenceColor(section?.color)
      ? section.color
      : DEFAULT_PRESENCE_COLOR
    const nextBodyColor = parseHexColor(section?.bodyColor)
    const nextEyeColor = parseHexColor(section?.eyeColor)
    const nextSize = parsePresenceSize(section?.size)
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
    const nextMoodId = parseMoodId(section?.moodId)
    const nextStatusLine = parseStatusLine(section?.statusLine)
    const nextBossNickname = parseBossNickname(section?.bossNickname)
    const nextMoodAt = typeof section?.moodAt === 'number' && Number.isFinite(section.moodAt)
      ? section.moodAt
      : DEFAULT_PRESENCE_MOOD_AT
    const nextPresets = parseStatusPresets(section?.statusPresets)
    const nextTitleScheme = parseTitleScheme(section?.titleScheme)
    const nextTitleBoss = parseSeatTitle(section?.titleBoss)
    const nextTitleManager = parseSeatTitle(section?.titleManager)
    const nextTitleAgent = parseSeatTitle(section?.titleAgent)
    if (
      this.enabled === nextEnabled
      && this.shape === nextShape
      && this.color === nextColor
      && this.bodyColor === nextBodyColor
      && this.eyeColor === nextEyeColor
      && this.size === nextSize
      && this.kit === nextKit
      && this.kitHat === nextHat
      && this.kitGlasses === nextGlasses
      && this.kitHeld === nextHeld
      && this.overlayHat === nextOverlayHat
      && this.overlayGlasses === nextOverlayGlasses
      && this.overlayHeld === nextOverlayHeld
      && encodeStickers(this.stickers) === encodeStickers(stickers)
      && this.moodId === nextMoodId
      && this.statusLine === nextStatusLine
      && this.bossNickname === nextBossNickname
      && this.moodAt === nextMoodAt
      && encodeStatusPresets(this.statusPresets) === encodeStatusPresets(nextPresets)
      && this.titleScheme === nextTitleScheme
      && this.titleBoss === nextTitleBoss
      && this.titleManager === nextTitleManager
      && this.titleAgent === nextTitleAgent
    ) return
    this.enabled = nextEnabled
    this.shape = nextShape
    this.color = nextColor
    this.bodyColor = nextBodyColor
    this.eyeColor = nextEyeColor
    this.size = nextSize
    this.kit = nextKit
    this.kitHat = nextHat
    this.kitGlasses = nextGlasses
    this.kitHeld = nextHeld
    this.overlayHat = nextOverlayHat
    this.overlayGlasses = nextOverlayGlasses
    this.overlayHeld = nextOverlayHeld
    this.stickers = stickers
    this.moodId = nextMoodId
    this.statusLine = nextStatusLine
    this.bossNickname = nextBossNickname
    this.moodAt = nextMoodAt
    this.statusPresets = nextPresets
    this.titleScheme = nextTitleScheme
    this.titleBoss = nextTitleBoss
    this.titleManager = nextTitleManager
    this.titleAgent = nextTitleAgent
    this.revision += 1
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
