/**
 * Overview presence ball — EmotionBall under Status utilities (all tabs).
 * Lifecycle is client-owned (ambient + activity rotation); AI `presence_set`
 * is a timed accent, not permanent control. Click pulses a short local mood.
 * Session delivery / fleet edges drive bounce · spin · burst so the ball
 * reacts like a companion, not a static LED.
 */
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  DEFAULT_PRESENCE_COLOR,
  DEFAULT_PRESENCE_SHAPE,
  isPresenceColor,
  isPresenceShape,
  resolvePresencePaint,
  splitLegacyKit,
  type PresenceColor,
  type PresencePaint,
  type PresenceShape,
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

/** Wire the Host-backed presence prefs into PresenceBall. */
export function bindPresenceSettingsRuntime(runtime: PresenceSettingsRuntime): void {
  presenceSettingsRuntime = runtime
}

function usePresenceShape(): PresenceShape {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getShape() ?? DEFAULT_PRESENCE_SHAPE,
    () => DEFAULT_PRESENCE_SHAPE,
  )
}

function usePresenceEngineHat(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getEngineHat() ?? 'none',
    () => 'none',
  )
}

function usePresenceEngineGlasses(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getEngineGlasses() ?? 'none',
    () => 'none',
  )
}

function usePresenceEngineHeld(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getEngineHeld() ?? 'none',
    () => 'none',
  )
}

function usePresenceOverlayHat(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getOverlayHat() ?? '',
    () => '',
  )
}

function usePresenceOverlayGlasses(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getOverlayGlasses() ?? '',
    () => '',
  )
}

function usePresenceOverlayHeld(): string {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getOverlayHeld() ?? '',
    () => '',
  )
}

function usePresenceColor(): PresenceColor {
  return useSyncExternalStore(
    (onStoreChange) => presenceSettingsRuntime?.subscribe(onStoreChange) ?? (() => {}),
    () => presenceSettingsRuntime?.getColor() ?? DEFAULT_PRESENCE_COLOR,
    () => DEFAULT_PRESENCE_COLOR,
  )
}

/** Follow `body[data-ds-dark-theme]` so light/dark palette paints stay in sync. */
function useChromeDark(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof document === 'undefined') return () => {}
      const obs = new MutationObserver(onStoreChange)
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      return () => { obs.disconnect() }
    },
    () => typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme'),
    () => false,
  )
}

function usePresencePaint(): PresencePaint {
  const color = usePresenceColor()
  const dark = useChromeDark()
  return resolvePresencePaint(color, dark)
}

const SCRIPT_BASE = '/presence/emotion-ball'
const SCRIPT_ORDER = ['rings.js', 'emotions.js', 'ball.js', 'engine.js'] as const
/** Bump when rings.js gains shapes so cached engine scripts reload. */
const PRESENCE_BALL_REV = '29'

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
    const names = SCRIPT_ORDER
    for (const name of names) {
      const src = `${SCRIPT_BASE}/${name}?v=${PRESENCE_BALL_REV}`
      document.querySelector(`script[data-xrk-presence="${name}"]`)?.remove()
      await new Promise<void>((resolve, reject) => {
        const el = document.createElement('script')
        el.src = src
        el.async = false
        el.dataset.xrkPresence = name
        el.onload = () => { resolve() }
        el.onerror = () => { reject(new Error(`failed to load ${src}`)) }
        document.head.appendChild(el)
      })
    }
    if (!window.EmotionBall?.create) {
      throw new Error('EmotionBall SDK missing after script load')
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
  if (input.runningSubs > 0) {
    return { emotionId: '03', tipKey: 'subs', source: 'auto' }
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
  readonly t: (key: string, params?: Record<string, string>) => string
  readonly loadingLabel: string
  readonly errorLabel: string
  /** Accessible hint for click-to-play. */
  readonly clickHint?: string
}) {
  const persona = sessionBallPersona(sessionId ?? 'default')
  const settingsShape = usePresenceShape()
  const settingsPaint = usePresencePaint()
  const settingsEngineHat = usePresenceEngineHat()
  const settingsEngineGlasses = usePresenceEngineGlasses()
  const settingsEngineHeld = usePresenceEngineHeld()
  const settingsHat = usePresenceOverlayHat()
  const settingsGlasses = usePresenceOverlayGlasses()
  const settingsHeld = usePresenceOverlayHeld()
  const dark = useChromeDark()
  const shape: PresenceShape = memberLook && isPresenceShape(memberLook.shape)
    ? memberLook.shape
    : settingsShape
  const paint: PresencePaint = memberLook && isPresenceColor(memberLook.color)
    ? resolvePresencePaint(memberLook.color, dark)
    : settingsPaint
  const split = splitLegacyKit(memberLook?.kit)
  const engineHat = memberLook
    ? (memberLook.kitHat ?? split.hat)
    : settingsEngineHat
  const engineGlasses = memberLook
    ? (memberLook.kitGlasses ?? split.glasses)
    : settingsEngineGlasses
  const engineHeld = memberLook
    ? (memberLook.kitHeld ?? 'none')
    : settingsEngineHeld
  const overlayHat = memberLook ? (memberLook.overlayHat ?? '') : settingsHat
  const overlayGlasses = memberLook ? (memberLook.overlayGlasses ?? '') : settingsGlasses
  const overlayHeld = memberLook ? (memberLook.overlayHeld ?? '') : settingsHeld
  const mountRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef<EmotionBallHandle | null>(null)
  const lastAccentRef = useRef<string>('')
  const lastEmotionKeyRef = useRef<string>('')
  const prevEmotionRef = useRef<PresenceEmotion | null>(null)
  const perfLiteRef = useRef(false)
  const accentLiteTimerRef = useRef<number | undefined>(undefined)
  const clickIndexRef = useRef(0)
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
    void loadEmotionBallScripts().then(
      () => {
        if (cancelled || !mountRef.current || !window.EmotionBall?.create) return
        mountRef.current.replaceChildren()
        // idle:false — engine must not auto-sleep over activity / sticky labels.
        // Seed lite from current workBusy; later toggles use setLite (no remount).
        const ball = window.EmotionBall.create(mountRef.current, {
          emotion: emotion.emotionId,
          idle: false,
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
        })
        ballRef.current = ball
        setReady(true)
        setError(undefined)
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setReady(false)
      },
    )
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
    // Remount when Settings shape/color, chrome scheme, session seed, or engine
    // gate changes. Emotion id is applied in the follow-up effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineActive, shape, paint.body, paint.eyes, persona.seed, engineHat, engineGlasses, engineHeld, overlayHat, overlayGlasses, overlayHeld])

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
    const id = pickRotated(CLICK_IDS, clickIndexRef.current)
    clickIndexRef.current += 1
    const stamp = Date.now()
    setLocal({ emotionId: id })
    setNowMs(stamp)
    setLastActivityAt(stamp)
    // Bounce first so the click always shows motion even if emotion is unchanged.
    const ball = ballRef.current
    ball?.bounce?.()
    ball?.resetIdle?.()
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
      <div className={css.meta}>
        {roleLabel
          ? <span className={css.role}>{roleLabel}</span>
          : null}
        <div className={css.row}>
          <span className={css.emotion}>{display.name}</span>
          {!compact && !pairSeat ? <span className={css.id}>{emotion.emotionId}</span> : null}
        </div>
        {display.tip
          ? <p className={css.tips} title={compact ? display.tip : undefined}>{display.tip}</p>
          : null}
      </div>
    </div>
  )
})
