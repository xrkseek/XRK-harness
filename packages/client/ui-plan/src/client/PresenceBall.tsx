/**
 * Overview presence ball — EmotionBall (aora-bot) in the Status Presence section.
 * One instance per Session; window mouse gaze + AI `presence_set` / activity-derived emotion.
 */
import { useEffect, useRef, useState } from 'react'
import css from './PresenceBall.module.css'

const SCRIPT_BASE = '/presence/emotion-ball'
const SCRIPT_ORDER = ['rings.js', 'emotions.js', 'ball.js', 'engine.js'] as const

/** Emotions that get a short celebrate FX when AI sticky-sets them. */
const CELEBRATE_IDS = new Set(['10', '33'])

export type PresenceAutoTip =
  | 'critical'
  | 'turn'
  | 'jobs'
  | 'subs'
  | 'warn'

export type PresenceEmotion = {
  readonly emotionId: string
  readonly tips?: string
  /** Auto-derived tip key; UI translates via `preview.status.presenceTip.*`. */
  readonly tipKey?: PresenceAutoTip
  readonly source: 'tool' | 'auto'
}

type EmotionBallHandle = {
  setEmotion: (id: string) => void
  setGaze: (nx: number, ny: number) => void
  handleAIMessage: (msg: string | { emotionId: string; tips?: string }) => void
  setActive: (on: boolean) => void
  spin?: (n?: number) => void
  burst?: (n?: number) => void
  bounce?: () => void
  destroy: () => void
}

type EmotionBallNs = {
  create: (
    el: HTMLElement,
    opts?: {
      emotion?: string
      idle?: boolean
      lite?: boolean
      eyeScale?: number
      shape?: string
    },
  ) => EmotionBallHandle
}

declare global {
  interface Window {
    EmotionBall?: EmotionBallNs
  }
}

let scriptsPromise: Promise<void> | undefined

function loadEmotionBallScripts(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.EmotionBall?.create) return Promise.resolve()
  if (scriptsPromise) return scriptsPromise
  scriptsPromise = (async () => {
    for (const name of SCRIPT_ORDER) {
      const src = `${SCRIPT_BASE}/${name}`
      // Skip if a prior Overview remount already injected this file.
      if (document.querySelector(`script[data-xrk-presence="${name}"]`)) continue
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
  })().catch((err) => {
    scriptsPromise = undefined
    throw err
  })
  return scriptsPromise
}

/**
 * Derive Overview emotion when AI has not sticky-set one.
 * Mirrors delivery / fleet activity so the ball stays alive without tool spam.
 */
export function derivePresenceEmotion(input: {
  readonly presence?: {
    readonly emotionId: string
    readonly tips?: string
    readonly source: 'tool'
  }
  readonly turnActive: boolean
  readonly runningJobs: number
  readonly runningSubs: number
  readonly fleetHealth: 'ok' | 'warn' | 'critical'
}): PresenceEmotion {
  if (input.presence?.emotionId) {
    return {
      emotionId: input.presence.emotionId,
      source: 'tool',
      ...(input.presence.tips ? { tips: input.presence.tips } : {}),
    }
  }
  if (input.fleetHealth === 'critical') {
    return { emotionId: '34', tipKey: 'critical', source: 'auto' }
  }
  if (input.turnActive) {
    return { emotionId: '30', tipKey: 'turn', source: 'auto' }
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
  return { emotionId: '02', source: 'auto' }
}

function playAccent(ball: EmotionBallHandle, emotionId: string, source: PresenceEmotion['source']): void {
  if (source !== 'tool') return
  if (CELEBRATE_IDS.has(emotionId)) {
    ball.burst?.(18)
    ball.bounce?.()
    return
  }
  if (emotionId === '21' || emotionId === '38') {
    ball.spin?.(2)
  }
}

export function PresenceBall({
  emotion,
  emotionName,
  tipText,
  loadingLabel,
  errorLabel,
}: {
  readonly emotion: PresenceEmotion
  readonly emotionName: string
  readonly tipText?: string
  readonly loadingLabel: string
  readonly errorLabel: string
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef<EmotionBallHandle | null>(null)
  const lastAccentRef = useRef<string>('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    let cancelled = false
    void loadEmotionBallScripts().then(
      () => {
        if (cancelled || !mountRef.current || !window.EmotionBall?.create) return
        mountRef.current.replaceChildren()
        // Tool-driven mood gets full FX; auto stays lite for Overview perf.
        const ball = window.EmotionBall.create(mountRef.current, {
          emotion: emotion.emotionId,
          idle: true,
          lite: emotion.source !== 'tool',
          eyeScale: 1.2,
          shape: 'blob',
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
      ballRef.current?.destroy()
      ballRef.current = null
    }
    // Mount once per component instance (Session remount remounts this tree).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const ball = ballRef.current
    if (!ball || !ready) return
    if (tipText) {
      ball.handleAIMessage({ emotionId: emotion.emotionId, tips: tipText })
    } else {
      ball.setEmotion(emotion.emotionId)
    }
    const accentKey = `${emotion.source}:${emotion.emotionId}:${tipText ?? ''}`
    if (accentKey !== lastAccentRef.current) {
      lastAccentRef.current = accentKey
      playAccent(ball, emotion.emotionId, emotion.source)
    }
  }, [emotion.emotionId, emotion.source, tipText, ready])

  // Gaze from the whole window — not just the stage hitbox — so eyes track
  // the cursor anywhere on the product shell relative to the ball center.
  useEffect(() => {
    if (!ready) return
    const applyGaze = (clientX: number, clientY: number): void => {
      const ball = ballRef.current
      const mount = mountRef.current
      if (!ball || !mount) return
      const rect = mount.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      // Half-size → ±1 at the ball rim; farther stays clamped at full look.
      const nx = (clientX - cx) / (rect.width / 2)
      const ny = (clientY - cy) / (rect.height / 2)
      ball.setGaze(
        Math.max(-1, Math.min(1, nx)),
        Math.max(-1, Math.min(1, ny)),
      )
    }
    const onPointerMove = (event: PointerEvent): void => {
      applyGaze(event.clientX, event.clientY)
    }
    const onBlur = (): void => {
      ballRef.current?.setGaze(0, 0)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', onBlur)
    }
  }, [ready])

  return (
    <div className={css.root} data-overview-presence="" data-source={emotion.source}>
      <div
        className={css.stage}
        data-ready={ready ? '' : undefined}
        data-source={emotion.source}
      >
        <div ref={mountRef} className={css.mount} />
        {!ready && !error ? <div className={css.loading}>{loadingLabel}</div> : null}
        {error ? <div className={css.error}>{errorLabel}: {error}</div> : null}
      </div>
      <div className={css.meta}>
        <div className={css.row}>
          <span className={css.emotion}>{emotionName}</span>
          <span className={css.id}>{emotion.emotionId}</span>
        </div>
        {tipText ? <p className={css.tips}>{tipText}</p> : null}
      </div>
    </div>
  )
}
