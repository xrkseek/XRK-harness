/**
 * Pure presence emotion / accent helpers — no React, no client-runtime.
 * Unit lane (`presence-emotion.test.ts`) imports here so bundling never
 * pulls PresenceBall → `@xrkseek/client-runtime/client`.
 */
import {
  PRESENCE_SLEEP_MS,
  PRESENCE_STANDBY_MS,
} from './presence-session-cues.ts'

/** AI sticky expires so ambient / activity can reclaim the ball. */
export const PRESENCE_TOOL_TTL_MS = 90_000

/** Emotions that get a short celebrate FX when AI sticky-sets them. */
const CELEBRATE_IDS = new Set(['10', '33'])

/** Sleep / power-off must not win while the session is actually working. */
const SLEEP_WHILE_BUSY = new Set(['00', '06', '41'])

/** Rotate while a turn is live — use the agent-work catalog, not sleep. */
const WORK_TURN_IDS = ['30', '32', '16', '36', '37', '39'] as const

/** Quiet ambient tour when nothing is running (life + light emotion). */
const AMBIENT_IDS = ['02', '03', '04', '02', '10', '11', '02', '04', '14', '19'] as const

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

/** Minimal ball surface for accent FX (tests fake this). */
export type PresenceAccentBall = {
  bounce?: (() => void) | undefined
  spin?: ((n?: number) => void) | undefined
  burst?: ((n?: number) => void) | undefined
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
  ball: PresenceAccentBall,
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
