/**
 * Overview presence ball — EmotionBall under Status utilities (all tabs).
 * Lifecycle is client-owned (ambient + activity rotation); AI `presence_set`
 * is a timed accent, not permanent control. Click pulses a short local mood.
 * Session delivery / fleet edges drive bounce · spin · burst so the ball
 * reacts like a companion, not a static LED.
 */
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { bindSeatChannelBossLabel } from '@xrkseek/client-runtime/client'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_ENABLED,
  DEFAULT_PRESENCE_MOOD_AT,
  DEFAULT_PRESENCE_MOOD_ID,
  DEFAULT_PRESENCE_SHAPE,
  DEFAULT_PRESENCE_STATUS_LINE,
  DEFAULT_PRESENCE_TITLE_SCHEME,
  DEFAULT_STATUS_PRESETS,
  isPresenceColor,
  isPresenceShape,
  resolvePresencePaint,
  resolveStatusPresetsForLocale,
  seatTitlesForScheme,
  splitLegacyKit,
  type PresenceColor,
  type PresencePaint,
  type PresenceSeatTitles,
  type PresenceShape,
  type PresenceTitleSchemeId,
} from '../presence-settings.ts'
import { PresenceKitMark } from './PresenceKitMark.tsx'
import {
  PRESENCE_SLEEP_MS,
  PRESENCE_STANDBY_MS,
} from './presence-session-cues.ts'
import type { PresenceSettingsRuntime } from './presence-settings-runtime.ts'
import css from './PresenceBall.module.css'

/** Set by ui-plan apply when Host settingsScope is available. */
let presenceSettingsRuntime: PresenceSettingsRuntime | undefined
/** Active product UI locale — kept in sync from ui-plan apply. */
let presenceUiLocale: 'zh' | 'en' | 'ja' = 'zh'
let seatTitlesCache: SeatTitlesSnapshot | undefined

/** Wire the Host-backed presence prefs into PresenceBall. */
export function bindPresenceSettingsRuntime(runtime: PresenceSettingsRuntime): void {
  presenceSettingsRuntime = runtime
  // A new runtime owns its own state — drop the merged snapshot so the next
  // read re-seeds from it instead of serving the previous runtime's look.
  presenceLookCache = undefined
  bossMoodCache = undefined
  seatTitlesCache = undefined
  // Subagent send echoes stitch `[老板（nick）]` before Host admit returns.
  bindSeatChannelBossLabel(() => {
    const titles = runtime.getSeatTitles(presenceUiLocale)
    const nick = runtime.getBossNickname().trim()
    return nick ? `${titles.boss}（${nick}）` : titles.boss
  })
}

/** Live write face for Overview Boss status sheet (same Host scope as Settings). */
export function getPresenceSettingsRuntime(): PresenceSettingsRuntime | undefined {
  return presenceSettingsRuntime
}

/** Keep Boss tip chips aligned with the active product UI language. */
export function bindPresenceUiLocale(locale: string): void {
  const next = locale === 'en' || locale === 'ja' ? locale : 'zh'
  if (presenceUiLocale === next) return
  presenceUiLocale = next
  bossMoodCache = undefined
  seatTitlesCache = undefined
}

/** Active UI language for locale-aware seat-title presets. */
export function getPresenceUiLocale(): 'zh' | 'en' | 'ja' {
  return presenceUiLocale
}

function noop(): void {}

/**
 * The whole Settings presence surface in one snapshot. The ball used to run
 * nine separate `useSyncExternalStore` reads over the same runtime; each one
 * carried an inline `subscribe` (new identity per render), so React tore down
 * and re-added every subscription on every paint.
 */
interface PresenceLook {
  readonly enabled: boolean
  readonly shape: PresenceShape
  readonly color: PresenceColor
  readonly engineHat: string
  readonly engineGlasses: string
  readonly engineHeld: string
  readonly overlayHat: string
  readonly overlayGlasses: string
  readonly overlayHeld: string
}

const DEFAULT_PRESENCE_LOOK: PresenceLook = {
  enabled: DEFAULT_PRESENCE_ENABLED,
  shape: DEFAULT_PRESENCE_SHAPE,
  color: DEFAULT_PRESENCE_COLOR,
  engineHat: 'none',
  engineGlasses: 'none',
  engineHeld: 'none',
  overlayHat: '',
  overlayGlasses: '',
  overlayHeld: '',
}

function readPresenceLook(): PresenceLook {
  const runtime = presenceSettingsRuntime
  if (runtime === undefined) return DEFAULT_PRESENCE_LOOK
  return {
    enabled: runtime.getEnabled(),
    shape: runtime.getShape(),
    color: runtime.getColor(),
    engineHat: runtime.getEngineHat(),
    engineGlasses: runtime.getEngineGlasses(),
    engineHeld: runtime.getEngineHeld(),
    overlayHat: runtime.getOverlayHat(),
    overlayGlasses: runtime.getOverlayGlasses(),
    overlayHeld: runtime.getOverlayHeld(),
  }
}

function samePresenceLook(a: PresenceLook, b: PresenceLook): boolean {
  return a.enabled === b.enabled
    && a.shape === b.shape
    && a.color === b.color
    && a.engineHat === b.engineHat
    && a.engineGlasses === b.engineGlasses
    && a.engineHeld === b.engineHeld
    && a.overlayHat === b.overlayHat
    && a.overlayGlasses === b.overlayGlasses
    && a.overlayHeld === b.overlayHeld
}

/** Fingerprint hold — `useSyncExternalStore` requires a reference-stable snapshot. */
let presenceLookCache: PresenceLook | undefined

function presenceLookSnapshot(): PresenceLook {
  const next = readPresenceLook()
  const cached = presenceLookCache
  if (cached !== undefined && samePresenceLook(cached, next)) return cached
  presenceLookCache = next
  return next
}

function presenceLookServerSnapshot(): PresenceLook {
  return DEFAULT_PRESENCE_LOOK
}

function presenceEnabledSnapshot(): boolean {
  return presenceLookSnapshot().enabled
}

function presenceEnabledServerSnapshot(): boolean {
  return DEFAULT_PRESENCE_ENABLED
}

/**
 * Module-level subscribe: stable identity across renders (React only keeps the
 * subscription alive when this does not change), while still reading the live
 * runtime — `bindPresenceSettingsRuntime` may land after first paint.
 */
function subscribePresenceSettings(onStoreChange: () => void): () => void {
  const runtime = presenceSettingsRuntime
  if (runtime === undefined) return noop
  return runtime.subscribe(onStoreChange)
}

const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const darkListeners = new Set<() => void>()
let darkObserver: MutationObserver | undefined

/**
 * One shared `body[data-ds-dark-theme]` observer for every ball on the page.
 * The old inline subscribe built a fresh MutationObserver per render and
 * re-`observe()`d document.body each time.
 */
function subscribeChromeDark(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return noop
  darkListeners.add(onStoreChange)
  if (darkObserver === undefined) {
    darkObserver = new MutationObserver(() => {
      for (const listener of darkListeners) listener()
    })
    darkObserver.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
  }
  return () => {
    darkListeners.delete(onStoreChange)
    if (darkListeners.size === 0) {
      darkObserver?.disconnect()
      darkObserver = undefined
    }
  }
}

function chromeDarkSnapshot(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute(DARK_ATTRIBUTE)
}

function chromeDarkServerSnapshot(): boolean {
  return false
}

/** One Settings subscription for the whole look. */
function usePresenceLook(): PresenceLook {
  return useSyncExternalStore(subscribePresenceSettings, presenceLookSnapshot, presenceLookServerSnapshot)
}

/** Master switch from Settings → General; false hides header dock + Overview rail. */
export function usePresenceEnabled(): boolean {
  return useSyncExternalStore(subscribePresenceSettings, presenceEnabledSnapshot, presenceEnabledServerSnapshot)
}

export interface BossMoodSnapshot {
  readonly moodId: string
  readonly statusLine: string
  readonly bossNickname: string
  readonly moodAt: number
  readonly statusPresets: readonly string[]
}

const DEFAULT_BOSS_MOOD: BossMoodSnapshot = {
  moodId: DEFAULT_PRESENCE_MOOD_ID,
  statusLine: DEFAULT_PRESENCE_STATUS_LINE,
  bossNickname: '',
  moodAt: DEFAULT_PRESENCE_MOOD_AT,
  statusPresets: DEFAULT_STATUS_PRESETS,
}

let bossMoodCache: BossMoodSnapshot | undefined

function readBossMood(): BossMoodSnapshot {
  const runtime = presenceSettingsRuntime
  if (runtime === undefined) return DEFAULT_BOSS_MOOD
  return {
    moodId: runtime.getMoodId(),
    statusLine: runtime.getStatusLine(),
    bossNickname: runtime.getBossNickname(),
    moodAt: runtime.getMoodAt(),
    statusPresets: resolveStatusPresetsForLocale(
      runtime.getStatusPresets(),
      presenceUiLocale,
    ),
  }
}

function sameBossMood(a: BossMoodSnapshot, b: BossMoodSnapshot): boolean {
  return a.moodId === b.moodId
    && a.statusLine === b.statusLine
    && a.bossNickname === b.bossNickname
    && a.moodAt === b.moodAt
    && a.statusPresets.length === b.statusPresets.length
    && a.statusPresets.every((tip, i) => tip === b.statusPresets[i])
}

function bossMoodSnapshot(): BossMoodSnapshot {
  const next = readBossMood()
  const cached = bossMoodCache
  if (cached !== undefined && sameBossMood(cached, next)) return cached
  bossMoodCache = next
  return next
}

function bossMoodServerSnapshot(): BossMoodSnapshot {
  return DEFAULT_BOSS_MOOD
}

/** Operator work mood for the Overview Boss seat (live Settings `ui-presence`). */
export function useBossMood(): BossMoodSnapshot {
  return useSyncExternalStore(subscribePresenceSettings, bossMoodSnapshot, bossMoodServerSnapshot)
}

export type SeatTitlesSnapshot = PresenceSeatTitles & {
  readonly scheme: PresenceTitleSchemeId
}

const DEFAULT_SEAT_TITLES: SeatTitlesSnapshot = {
  scheme: DEFAULT_PRESENCE_TITLE_SCHEME,
  ...seatTitlesForScheme(DEFAULT_PRESENCE_TITLE_SCHEME, 'zh'),
}

function readSeatTitlesSnapshot(): SeatTitlesSnapshot {
  const runtime = presenceSettingsRuntime
  if (runtime === undefined) {
    return {
      scheme: DEFAULT_PRESENCE_TITLE_SCHEME,
      ...seatTitlesForScheme(DEFAULT_PRESENCE_TITLE_SCHEME, presenceUiLocale),
    }
  }
  const scheme = runtime.getTitleScheme()
  const titles = runtime.getSeatTitles(presenceUiLocale)
  return { scheme, ...titles }
}

function sameSeatTitles(a: SeatTitlesSnapshot, b: SeatTitlesSnapshot): boolean {
  return a.scheme === b.scheme
    && a.boss === b.boss
    && a.manager === b.manager
    && a.agent === b.agent
}

function seatTitlesSnapshot(): SeatTitlesSnapshot {
  const next = readSeatTitlesSnapshot()
  const cached = seatTitlesCache
  if (cached !== undefined && sameSeatTitles(cached, next)) return cached
  seatTitlesCache = next
  return next
}

/** Classic 老板 / 经理 / 干员 titles from Settings `ui-presence.titleScheme`. */
export function useSeatTitles(): SeatTitlesSnapshot {
  return useSyncExternalStore(
    subscribePresenceSettings,
    seatTitlesSnapshot,
    () => DEFAULT_SEAT_TITLES,
  )
}

/** Follow `body[data-ds-dark-theme]` so light/dark palette paints stay in sync. */
function useChromeDark(): boolean {
  return useSyncExternalStore(subscribeChromeDark, chromeDarkSnapshot, chromeDarkServerSnapshot)
}

const SCRIPT_BASE = '/presence/emotion-ball'
/** Worker host first; SVG stack loads via EmotionBall.loadLegacySvg when needed. */
const SCRIPT_ORDER = ['presence-worker-host.js'] as const
/** Bump when worker / canvas render path changes so cached scripts reload. */
const PRESENCE_BALL_REV = '40'

/** Emotions that get a short celebrate FX when AI sticky-sets them. */
const CELEBRATE_IDS = new Set(['10', '33'])

/** AI sticky expires so ambient / activity can reclaim the ball. */
export const PRESENCE_TOOL_TTL_MS = 90_000

/** Sleep / power-off must not win while the session is actually working. */
const SLEEP_WHILE_BUSY = new Set(['00', '06', '41'])

/** Rotate while a turn is live — use the agent-work catalog, not sleep. */
const WORK_TURN_IDS = ['30', '32', '16', '36', '37', '39'] as const

/** Quiet ambient tour when nothing is running (life + light emotion). */
const AMBIENT_IDS = ['02', '03', '04', '02', '10', '11', '02', '04', '14', '19'] as const

/** User click pulse — playful set, then hand back to auto. */
const CLICK_IDS = ['10', '13', '03', '33', '14', '11', '19', '07'] as const

const PHASE_MS = 8_000
const LOCAL_PULSE_MS = 4_500

export type PresenceAutoTip =
  | 'critical'
  | 'toolError'
  | 'turn'
  | 'jobs'
  | 'subs'
  | 'warn'
  | 'listen'
  | 'compact'
  | 'standby'
  | 'sleep'
  | 'ambient'
  | 'local'

export type PresenceEmotion = {
  readonly emotionId: string
  readonly tips?: string
  /** Auto-derived tip key; UI translates via `preview.status.presenceTip.*`. */
  readonly tipKey?: PresenceAutoTip
  readonly source: 'tool' | 'auto' | 'local'
}

/** 三槽贴图（data URL）。空串 = 该槽无贴图。 */
type DressingImages = {
  readonly hat?: string
  readonly glasses?: string
  readonly held?: string
}

type EmotionBallHandle = {
  setEmotion: (id: string, opts?: { auto?: boolean }) => void
  setGaze: (nx: number, ny: number) => void
  handleAIMessage: (msg: string | { emotionId: string; tips?: string }) => void
  setActive: (on: boolean) => void
  setLite?: (on: boolean) => void
  spin?: (n?: number) => void
  burst?: (n?: number) => void
  bounce?: () => void
  resetIdle?: () => void
  setKit?: (kit: string) => void
  setDressing?: (hat: string, glasses: string, held?: string, images?: string | DressingImages) => void
  destroy: () => void
  /** Worker bridge: `fatal` means the render thread died. */
  on?: (evt: string, cb: (payload?: { message?: string }) => void) => void
}

type EmotionBallNs = {
  create: (
    el: HTMLElement,
    opts?: {
      emotion?: string
      idle?: boolean | {
        standbyAfter?: number
        sleepAfter?: number
        standbyId?: string
        sleepId?: string
      }
      lite?: boolean
      eyeScale?: number
      shape?: string
      color?: string
      eyeColor?: string
      seed?: number
      kit?: string
      kitHat?: string
      kitGlasses?: string
      kitHeld?: string
      /** 三槽贴图：进引擎层，跟随呼吸/转头/形变。已弃用的 DOM 覆盖层请勿再用。 */
      hatImage?: string
      glassesImage?: string
      heldImage?: string
    },
  ) => EmotionBallHandle
  /** True when OffscreenCanvas + Worker path is available. */
  canOffscreen?: () => boolean
  /** Load SVG rings/emotions/ball/engine when Worker path is unavailable. */
  loadLegacySvg?: () => Promise<void>
}

export type SessionBallPersona = {
  /** Stable engine seed so motion differs per session (color is Settings-owned). */
  readonly seed: number
}

/** FNV-1a → stable per-session engine seed (shape + color are Settings-owned). */
export function sessionBallPersona(sessionId: string): SessionBallPersona {
  let h = 2166136261
  for (let i = 0; i < sessionId.length; i += 1) {
    h ^= sessionId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const u = h >>> 0
  return {
    seed: (u % 10_000) / 100,
  }
}

declare global {
  interface Window {
    EmotionBall?: EmotionBallNs
  }
}

let scriptsPromise: Promise<void> | undefined

function loadScript(name: string): Promise<void> {
  const src = `${SCRIPT_BASE}/${name}?v=${PRESENCE_BALL_REV}`
  document.querySelector(`script[data-xrk-presence="${name}"]`)?.remove()
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.dataset.xrkPresence = name
    el.onload = () => { resolve() }
    el.onerror = () => { reject(new Error(`failed to load ${src}`)) }
    document.head.appendChild(el)
  })
}

function loadEmotionBallScripts(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (
    window.EmotionBall?.create
    && document.documentElement.dataset.xrkPresenceRev === PRESENCE_BALL_REV
  ) {
    return Promise.resolve()
  }
  if (scriptsPromise) return scriptsPromise
  scriptsPromise = (async () => {
    // Worker host owns EmotionBall.create (Offscreen). SVG stack is lazy.
    for (const name of SCRIPT_ORDER) {
      await loadScript(name)
    }
    const sdk = window.EmotionBall
    if (!sdk?.create) {
      throw new Error('EmotionBall SDK missing after script load')
    }
    if (sdk.canOffscreen?.() !== true) {
      if (typeof sdk.loadLegacySvg !== 'function') {
        throw new Error('EmotionBall.loadLegacySvg missing')
      }
      await sdk.loadLegacySvg()
    }
    document.documentElement.dataset.xrkPresenceRev = PRESENCE_BALL_REV
  })().catch((err) => {
    scriptsPromise = undefined
    throw err
  })
  return scriptsPromise
}

function pickRotated(ids: readonly string[], phase: number): string {
  const len = ids.length
  if (len === 0) return '02'
  const i = ((phase % len) + len) % len
  return ids[i]!
}

/**
 * Resolve Overview emotion.
 * Priority: local click → fresh AI sticky → fleet critical → recent tool error →
 * delivery / compaction / jobs → long-idle sleep/standby → ambient tour.
 * Client owns sleep (engine idle stays off so phase rotation cannot fight it).
 */
export function derivePresenceEmotion(input: {
  readonly presence?: {
    readonly emotionId: string
    readonly tips?: string
    readonly source: 'tool'
    readonly updatedAt?: number
    /**
     * Operator Boss mood from Settings — never TTL / fleet / idle overwrite.
     * Only a fresh manual edit (new moodId / tips) changes the face.
     */
    readonly pinned?: boolean
  }
  readonly turnActive: boolean
  readonly runningJobs: number
  readonly runningSubs: number
  readonly fleetHealth: 'ok' | 'warn' | 'critical'
  /** Admits waiting while the latch is free — listen / wait-for-user beat. */
  readonly queued?: number
  readonly steering?: number
  /** Context compaction pipeline running. */
  readonly compactionBusy?: boolean
  /** Recent tool-result failure cue (client timeline). */
  readonly toolError?: boolean | { readonly name?: string }
  /** Ms since last session activity (busy / poke / sticky). */
  readonly idleMs?: number
  /** Wall clock for sticky TTL (tests inject). */
  readonly nowMs?: number
  /** Integer phase for work / ambient rotation. */
  readonly phase?: number
  /** Short user click pulse. */
  readonly local?: {
    readonly emotionId: string
    readonly tips?: string
  }
}): PresenceEmotion {
  if (input.local?.emotionId) {
    return {
      emotionId: input.local.emotionId,
      source: 'local',
      tipKey: 'local',
      ...(input.local.tips ? { tips: input.local.tips } : {}),
    }
  }

  // Pinned Boss status: user-owned only — skip auto standby / turn rotation.
  if (input.presence?.emotionId && input.presence.pinned) {
    return {
      emotionId: input.presence.emotionId,
      source: 'tool',
      ...(input.presence.tips ? { tips: input.presence.tips } : {}),
    }
  }

  const busy =
    input.turnActive
    || input.runningJobs > 0
    || input.runningSubs > 0
    || input.compactionBusy === true
  const now = input.nowMs ?? Date.now()
  const phase = input.phase ?? 0
  const inbox =
    (input.queued ?? 0) > 0
    || (input.steering ?? 0) > 0
  const idleMs = typeof input.idleMs === 'number' && Number.isFinite(input.idleMs)
    ? Math.max(0, input.idleMs)
    : 0
  const toolError = input.toolError === true
    || (typeof input.toolError === 'object' && input.toolError !== null)

  if (input.presence?.emotionId) {
    const updatedAt = input.presence.updatedAt
    const age = typeof updatedAt === 'number' ? now - updatedAt : 0
    const stale = typeof updatedAt === 'number' && age > PRESENCE_TOOL_TTL_MS
    const sleepClash = busy && SLEEP_WHILE_BUSY.has(input.presence.emotionId)
    if (!stale && !sleepClash) {
      return {
        emotionId: input.presence.emotionId,
        source: 'tool',
        ...(input.presence.tips ? { tips: input.presence.tips } : {}),
      }
    }
  }

  if (input.fleetHealth === 'critical') {
    return { emotionId: '34', tipKey: 'critical', source: 'auto' }
  }
  // Tool failures beat work rotation so Overview reacts to "Unknown tool" etc.
  if (toolError) {
    const name = typeof input.toolError === 'object' ? input.toolError.name : undefined
    return {
      emotionId: '34',
      tipKey: 'toolError',
      source: 'auto',
      ...(name ? { tips: name } : {}),
    }
  }
  // Prefer「子代理活跃」over「回合进行中」when a child is draining. A parent
  // that already parked (or is blocked in wait_agent) still holds a turn latch,
  // but the Overview ball must not look like the home model is still thinking.
  if (input.runningSubs > 0) {
    return { emotionId: '03', tipKey: 'subs', source: 'auto' }
  }
  if (input.turnActive) {
    return {
      emotionId: pickRotated(WORK_TURN_IDS, phase),
      tipKey: 'turn',
      source: 'auto',
    }
  }
  if (inbox) {
    return { emotionId: '35', tipKey: 'listen', source: 'auto' }
  }
  if (input.compactionBusy) {
    return { emotionId: '36', tipKey: 'compact', source: 'auto' }
  }
  if (input.runningJobs > 0) {
    return { emotionId: '40', tipKey: 'jobs', source: 'auto' }
  }
  if (input.fleetHealth === 'warn') {
    return { emotionId: '13', tipKey: 'warn', source: 'auto' }
  }
  if (!busy && idleMs >= PRESENCE_SLEEP_MS) {
    return { emotionId: '00', tipKey: 'sleep', source: 'auto' }
  }
  if (!busy && idleMs >= PRESENCE_STANDBY_MS) {
    return { emotionId: '06', tipKey: 'standby', source: 'auto' }
  }
  return {
    emotionId: pickRotated(AMBIENT_IDS, phase),
    tipKey: 'ambient',
    source: 'auto',
  }
}

/**
 * Motion accents for sticky AI · click · session tipKey edges.
 * Phase rotation within the same tipKey stays quiet (no spam bounce).
 * @returns true when spin/burst ran — caller must leave lite briefly so ribbons paint.
 */
export function playPresenceAccent(
  ball: EmotionBallHandle,
  next: PresenceEmotion,
  prev: PresenceEmotion | null,
): boolean {
  if (next.source === 'local') {
    ball.bounce?.()
    ball.spin?.(1)
    return true
  }
  if (next.source === 'tool') {
    if (CELEBRATE_IDS.has(next.emotionId)) {
      ball.burst?.(18)
      ball.bounce?.()
      return true
    }
    if (next.emotionId === '21' || next.emotionId === '38') {
      ball.spin?.(2)
      return true
    }
    if (
      prev === null
      || prev.source !== 'tool'
      || prev.emotionId !== next.emotionId
    ) {
      ball.bounce?.()
    }
    return false
  }

  const prevKey = prev?.tipKey
  const nextKey = next.tipKey
  if (!nextKey || nextKey === prevKey) return false

  if (
    nextKey === 'turn'
    || nextKey === 'jobs'
    || nextKey === 'subs'
    || nextKey === 'listen'
    || nextKey === 'compact'
  ) {
    ball.bounce?.()
    return false
  }
  if (nextKey === 'critical' || nextKey === 'warn' || nextKey === 'toolError') {
    ball.spin?.(2)
    return true
  }
  if (nextKey === 'sleep' || nextKey === 'standby') {
    return false
  }
  if (
    nextKey === 'ambient'
    && prevKey
    && (prevKey === 'sleep' || prevKey === 'standby')
  ) {
    ball.bounce?.()
    return false
  }
  if (
    nextKey === 'ambient'
    && prevKey
    && prevKey !== 'ambient'
    && prevKey !== 'local'
  ) {
    ball.burst?.(10)
    ball.bounce?.()
    return true
  }
  return false
}

export function presenceDisplay(
  emotion: PresenceEmotion,
  t: (key: string, params?: Record<string, string>) => string,
): { name: string; tip?: string } {
  const nameKey = `preview.status.emotion.${emotion.emotionId}`
  const named = t(nameKey)
  const name =
    named === nameKey || named.startsWith('preview.status.emotion.')
      ? t('preview.status.emotion.fallback', { id: emotion.emotionId })
      : named
  const tipFromKey = emotion.tipKey
    ? t(`preview.status.presenceTip.${emotion.tipKey}`)
    : undefined
  // tipKey copy + optional raw accent (e.g. failed tool name) — never drop i18n.
  const tip =
    tipFromKey && emotion.tips && emotion.tips !== tipFromKey
      ? `${tipFromKey} · ${emotion.tips}`
      : (emotion.tips ?? tipFromKey)
  return tip ? { name, tip } : { name }
}

/** Idle ambient tips that may yield the caption line to a session 支线. */
const IDLE_PRESENCE_TIP_KEYS = new Set<PresenceAutoTip>([
  'sleep',
  'standby',
  'ambient',
])

/**
 * Prefer session 支线 most of the time; flash the presence status tip on every
 * 4th ambient phase. Busy / sticky tips always win over the sideline.
 */
export function resolvePresenceTipLine(input: {
  readonly tip?: string
  readonly tipKey?: PresenceAutoTip
  readonly captionHint?: string
  readonly phase: number
}): string | undefined {
  const hint = input.captionHint?.trim()
  const tip = input.tip?.trim()
  if (!hint) return tip || undefined
  if (!tip) return hint
  if (input.tipKey && !IDLE_PRESENCE_TIP_KEYS.has(input.tipKey)) return tip
  // 3/4 sideline · 1/4 status while idle (phase ticks every PHASE_MS).
  return input.phase % 4 === 0 ? tip : hint
}

export const PresenceBall = memo(function PresenceBall({
  sessionId,
  presence,
  turnActive,
  runningJobs,
  runningSubs,
  fleetHealth,
  queued = 0,
  steering = 0,
  compactionBusy = false,
  toolError,
  activityAt = 0,
  compact = false,
  density = 'rail',
  engineActive = true,
  memberLook,
  pairSeat = false,
  seat,
  roleLabel,
  captionHint,
  onStageClick,
  t,
  loadingLabel,
  errorLabel,
  clickHint,
}: {
  /** Stable session key — picks a distinct ball shape / color / motion seed. */
  readonly sessionId?: string
  readonly presence?: {
    readonly emotionId: string
    readonly tips?: string
    readonly source: 'tool'
    readonly updatedAt?: number
    /** See {@link derivePresenceEmotion} — Boss mood never auto-overwrites. */
    readonly pinned?: boolean
  }
  readonly turnActive: boolean
  readonly runningJobs: number
  readonly runningSubs: number
  readonly fleetHealth: 'ok' | 'warn' | 'critical'
  readonly queued?: number
  readonly steering?: number
  readonly compactionBusy?: boolean
  /** Recent tool-result failure from the conversation timeline. */
  readonly toolError?: boolean | { readonly name?: string }
  /**
   * Wall clock of last transcript / sticky beat (seeds idle when Overview
   * opens on an already-quiet session).
   */
  readonly activityAt?: number
  /**
   * Compact chip: small stage + one-line label (Overview presence collapsed).
   */
  readonly compact?: boolean
  /**
   * Compact density: `rail` (Overview) vs `header` (session title row — taller
   * chip is out-of-flow so Overview open/close does not reflow chrome).
   */
  readonly density?: 'rail' | 'header'
  /**
   * When false, keep the reserved stage (spinner) but do not load / create
   * EmotionBall. Overview uses this so expand can paint the slot first, then
   * start the engine after the header dock exits.
   */
  readonly engineActive?: boolean
  /** Child 干员 look — overrides Settings presence so the home ball stays unique. */
  readonly memberLook?: {
    readonly shape: string
    readonly color: string
    readonly kit?: string
    readonly kitHat?: string
    readonly kitGlasses?: string
    readonly kitHeld?: string
    readonly overlayHat?: string
    readonly overlayGlasses?: string
    readonly overlayHeld?: string
  }
  /** Smaller seat inside the Overview dual-ball pair. */
  readonly pairSeat?: boolean
  /** Dual-ball: 委派方 (`from`) vs 被委派方 (`to`). */
  readonly seat?: 'from' | 'to'
  /** Caption under the ball (委派方 / 被委派方 · name). */
  readonly roleLabel?: string
  /**
   * Session 支线 caption. While idle, shown most of the time and yields to the
   * ambient status tip every fourth phase; busy tips still win.
   */
  readonly captionHint?: string
  /**
   * Override click-to-play. Boss Overview uses this to open the status sheet
   * instead of cycling random emotions.
   */
  readonly onStageClick?: () => void
  readonly t: (key: string, params?: Record<string, string>) => string
  readonly loadingLabel: string
  readonly errorLabel: string
  /** Accessible hint for click-to-play. */
  readonly clickHint?: string
}) {
  const persona = sessionBallPersona(sessionId ?? 'default')
  const look = usePresenceLook()
  const dark = useChromeDark()
  // When `memberLook` is set (including pending fallback), never blend in
  // Settings 老板装扮 — invalid fields fall back to defaults, not ui-presence.
  const shape: PresenceShape = memberLook
    ? (isPresenceShape(memberLook.shape) ? memberLook.shape : DEFAULT_PRESENCE_SHAPE)
    : look.shape
  const paint: PresencePaint = memberLook
    ? resolvePresencePaint(
      isPresenceColor(memberLook.color) ? memberLook.color : DEFAULT_PRESENCE_COLOR,
      dark,
    )
    : resolvePresencePaint(look.color, dark)
  const split = splitLegacyKit(memberLook?.kit)
  const engineHat = memberLook
    ? (memberLook.kitHat ?? split.hat)
    : look.engineHat
  const engineGlasses = memberLook
    ? (memberLook.kitGlasses ?? split.glasses)
    : look.engineGlasses
  const engineHeld = memberLook
    ? (memberLook.kitHeld ?? 'none')
    : look.engineHeld
  const overlayHat = memberLook ? (memberLook.overlayHat ?? '') : look.overlayHat
  const overlayGlasses = memberLook ? (memberLook.overlayGlasses ?? '') : look.overlayGlasses
  const overlayHeld = memberLook ? (memberLook.overlayHeld ?? '') : look.overlayHeld
  const mountRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef<EmotionBallHandle | null>(null)
  const lastAccentRef = useRef<string>('')
  const lastEmotionKeyRef = useRef<string>('')
  const prevEmotionRef = useRef<PresenceEmotion | null>(null)
  const perfLiteRef = useRef(false)
  const accentLiteTimerRef = useRef<number | undefined>(undefined)
  const clickIndexRef = useRef(0)
  const [renderGen, setRenderGen] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState(0)
  const [local, setLocal] = useState<{ emotionId: string; tips?: string } | undefined>(undefined)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [lastActivityAt, setLastActivityAt] = useState(() => Math.max(Date.now(), activityAt))

  // Host/fleet work — drives FX budget. Click pulse is NOT work: it must keep
  // full ribbons for spin, while still zeroing idleMs via sessionBusy below.
  const workBusy =
    turnActive
    || runningJobs > 0
    || runningSubs > 0
    || compactionBusy
    || queued > 0
    || steering > 0
    || toolError === true
    || (typeof toolError === 'object' && toolError !== null)
  const sessionBusy = workBusy || Boolean(local)

  // Track transcript / presence beats only — never stamp Date.now() while busy
  // (that forced a setState on every cue notify and amplified Overview thrash).
  useEffect(() => {
    const stamp = Math.max(activityAt, presence?.updatedAt ?? 0)
    if (stamp <= 0) return
    setLastActivityAt((prev) => (stamp > prev ? stamp : prev))
  }, [activityAt, presence?.updatedAt])

  // Busy means "not idle" without mutating the clock.
  const idleMs = sessionBusy ? 0 : Math.max(0, nowMs - lastActivityAt)

  const emotion = derivePresenceEmotion({
    ...(presence ? { presence } : {}),
    turnActive,
    runningJobs,
    runningSubs,
    fleetHealth,
    queued,
    steering,
    compactionBusy,
    ...(toolError !== undefined ? { toolError } : {}),
    idleMs,
    nowMs,
    phase,
    ...(local ? { local } : {}),
  })
  const display = presenceDisplay(emotion, t)
  const tipLine = resolvePresenceTipLine({
    ...(display.tip !== undefined ? { tip: display.tip } : {}),
    ...(emotion.tipKey !== undefined ? { tipKey: emotion.tipKey } : {}),
    ...(captionHint !== undefined ? { captionHint } : {}),
    phase,
  })
  const resting = emotion.tipKey === 'sleep' || emotion.tipKey === 'standby'
  // Stream isolation budget: lite only for real work. Idle ambient / sleep keep full FX.
  const perfLite = workBusy
  perfLiteRef.current = perfLite

  // Ambient / work rotation — client lifecycle independent of AI sticky.
  useEffect(() => {
    if (!engineActive) return
    const id = window.setInterval(() => {
      setPhase((n) => n + 1)
      setNowMs(Date.now())
    }, PHASE_MS)
    return () => { window.clearInterval(id) }
  }, [engineActive])

  // Expire local pulse.
  useEffect(() => {
    if (!local) return
    const id = window.setTimeout(() => { setLocal(undefined) }, LOCAL_PULSE_MS)
    return () => { window.clearTimeout(id) }
  }, [local])

  useEffect(() => {
    const el = mountRef.current
    if (!el || !engineActive) return
    let cancelled = false
    void loadEmotionBallScripts()
      .then(async () => {
        if (cancelled || !mountRef.current || !window.EmotionBall?.create) return
        const opts = {
          emotion: emotion.emotionId,
          idle: false as const,
          lite: workBusy,
          eyeScale: 1.2,
          shape,
          color: paint.body,
          eyeColor: paint.eyes,
          seed: persona.seed,
          kitHat: engineHat,
          kitGlasses: engineGlasses,
          kitHeld: engineHeld,
          hatImage: overlayHat,
          glassesImage: overlayGlasses,
          heldImage: overlayHeld,
        }
        const open = async (): Promise<EmotionBallHandle> => {
          const node = mountRef.current
          if (!node || !window.EmotionBall?.create) {
            throw new Error('EmotionBall mount missing')
          }
          node.replaceChildren()
          try {
            return window.EmotionBall.create(node, opts)
          } catch (err) {
            await window.EmotionBall.loadLegacySvg?.()
            const retry = mountRef.current
            if (!retry || !window.EmotionBall.create) throw err
            retry.replaceChildren()
            return window.EmotionBall.create(retry, opts)
          }
        }
        const ball = await open()
        ball.on?.('fatal', () => {
          if (cancelled) return
          const remount = (): void => {
            if (!cancelled) setRenderGen((n) => n + 1)
          }
          const load = window.EmotionBall?.loadLegacySvg
          if (load) void load().then(remount, remount)
          else remount()
        })
        ballRef.current = ball
        setReady(true)
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setReady(false)
      })
    return () => {
      cancelled = true
      if (accentLiteTimerRef.current !== undefined) {
        window.clearTimeout(accentLiteTimerRef.current)
        accentLiteTimerRef.current = undefined
      }
      ballRef.current?.destroy()
      ballRef.current = null
      setReady(false)
    }
    // Remount only when body geometry changes (shape / paint / seed / engine
    // gate). Kit + overlay dressing hot-update via setDressing — remounting the
    // whole EmotionBall on every 装扮 click was the main latency users felt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineActive, shape, paint.body, paint.eyes, persona.seed, renderGen])

  // Dressing hot path — swap hat / glasses / held without tearing down the ball.
  useEffect(() => {
    const ball = ballRef.current
    if (!ball || !ready) return
    ball.setDressing?.(engineHat, engineGlasses, engineHeld, {
      hat: overlayHat,
      glasses: overlayGlasses,
      held: overlayHeld,
    })
  }, [ready, engineHat, engineGlasses, engineHeld, overlayHat, overlayGlasses, overlayHeld])

  // Runtime FX budget — never remount for lite toggles. While a heavy accent
  // holds full FX, skip; the timer restores from perfLiteRef when it ends.
  useEffect(() => {
    const ball = ballRef.current
    if (!ball || !ready || accentLiteTimerRef.current !== undefined) return
    ball.setLite?.(perfLite)
  }, [ready, perfLite])

  useEffect(() => {
    const ball = ballRef.current
    if (!ball || !ready) return
    // Only push into the engine when the *content* of the emotion changes.
    // Fresh `emotion` objects every React render must not restart transitions.
    const tip = display.tip
    const emotionKey = `${emotion.source}:${emotion.emotionId}:${emotion.tipKey ?? ''}`
    const accentKey = `${emotionKey}:${tip ?? ''}`
    if (accentKey === lastAccentRef.current) return
    const emotionChanged = emotionKey !== lastEmotionKeyRef.current
    if (emotionChanged) {
      if (tip && emotion.source === 'tool') {
        ball.handleAIMessage({ emotionId: emotion.emotionId, tips: tip })
      } else {
        // auto:true — work/ambient rotation must not poke the engine's activity clock
        ball.setEmotion(emotion.emotionId, { auto: true })
      }
      // Sleep / standby own the quiet clock — do not poke the engine awake.
      if (!resting) ball.resetIdle?.()
      const prev = prevEmotionRef.current
      // Drop lite only when work budget is on, so spin/burst ribbons can paint.
      const wasLite = perfLiteRef.current
      if (wasLite) ball.setLite?.(false)
      const heavy = playPresenceAccent(ball, emotion, prev)
      if (accentLiteTimerRef.current !== undefined) {
        window.clearTimeout(accentLiteTimerRef.current)
        accentLiteTimerRef.current = undefined
      }
      if (heavy && wasLite) {
        accentLiteTimerRef.current = window.setTimeout(() => {
          accentLiteTimerRef.current = undefined
          ballRef.current?.setLite?.(perfLiteRef.current)
        }, 900)
      } else if (wasLite) {
        ball.setLite?.(true)
      }
      prevEmotionRef.current = emotion
      lastEmotionKeyRef.current = emotionKey
    }
    lastAccentRef.current = accentKey
  }, [
    emotion.emotionId,
    emotion.source,
    emotion.tipKey,
    emotion.tips,
    display.tip,
    ready,
    resting,
  ])

  // Gaze: coalesce pointer samples to one setGaze per animation frame.
  // Keep tracking during a turn — parking gaze at origin froze the face
  // exactly while the model was working.
  useEffect(() => {
    if (!ready) return
    let raf = 0
    let pendingX = 0
    let pendingY = 0
    const flushGaze = (): void => {
      raf = 0
      const ball = ballRef.current
      const mount = mountRef.current
      if (!ball || !mount) return
      const rect = mount.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const nx = (pendingX - cx) / (rect.width / 2)
      const ny = (pendingY - cy) / (rect.height / 2)
      ball.setGaze(
        Math.max(-1, Math.min(1, nx)),
        Math.max(-1, Math.min(1, ny)),
      )
    }
    const onPointerMove = (event: PointerEvent): void => {
      pendingX = event.clientX
      pendingY = event.clientY
      if (raf !== 0) return
      raf = window.requestAnimationFrame(flushGaze)
    }
    const onBlur = (): void => {
      ballRef.current?.setGaze(0, 0)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', onBlur)
      if (raf !== 0) window.cancelAnimationFrame(raf)
    }
  }, [ready])

  const onStageActivate = (): void => {
    // Bounce first so the click always shows motion even if emotion is unchanged.
    const ball = ballRef.current
    ball?.bounce?.()
    ball?.resetIdle?.()
    if (onStageClick) {
      onStageClick()
      return
    }
    const id = pickRotated(CLICK_IDS, clickIndexRef.current)
    clickIndexRef.current += 1
    const stamp = Date.now()
    setLocal({ emotionId: id })
    setNowMs(stamp)
    setLastActivityAt(stamp)
  }

  return (
    <div
      className={css.root}
      data-overview-presence=""
      data-source={emotion.source}
      data-compact={compact ? '' : undefined}
      data-density={compact ? density : undefined}
      data-pair={pairSeat ? '' : undefined}
      data-seat={seat}
    >
      <button
        type="button"
        className={css.stage}
        data-source={emotion.source}
        aria-label={clickHint ?? display.name}
        aria-busy={!ready && !error ? true : undefined}
        title={!ready && !error ? loadingLabel : undefined}
        onClick={onStageActivate}
      >
        <div ref={mountRef} className={css.mount} data-ready={ready ? '' : undefined} aria-hidden />
        {/* 装扮贴图不再走 DOM 绝对定位层：三槽贴图都进引擎（hatG/specsG/heldG），
            按轮廓与眼球锚点逐帧布局，才跟得上呼吸/转头/情绪形变。 */}
        {/* Spinner stays mounted and fades out under the ball. Unmounting it on
            ready punched an empty frame between the wait and the 280ms fade-in. */}
        <div
          className={css.loading}
          data-hidden={ready || error ? '' : undefined}
          role="status"
          aria-label={loadingLabel}
          aria-hidden={ready || error ? true : undefined}
        >
          <span className={css.spinner} aria-hidden />
        </div>
        {error ? <div className={css.error}>{errorLabel}: {error}</div> : null}
      </button>
      <div className={css.meta} data-presence-meta="">
        {roleLabel
          ? <span className={css.role}>{roleLabel}</span>
          : null}
        <div className={css.row}>
          <span className={css.emotion}>{display.name}</span>
          {!compact && !pairSeat ? <span className={css.id}>{emotion.emotionId}</span> : null}
        </div>
        {tipLine
          ? <p className={css.tips} title={compact ? tipLine : undefined}>{tipLine}</p>
          : null}
      </div>
    </div>
  )
})
