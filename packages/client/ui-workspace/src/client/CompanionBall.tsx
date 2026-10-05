/**
 * Compact EmotionBall mount for Agent Team — same engine as the session header.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import css from './CompanionBall.module.css'

const SCRIPT_BASE = '/presence/emotion-ball'
const SCRIPT_ORDER = ['rings.js', 'emotions.js', 'ball.js', 'engine.js'] as const
/** Bump when rings.js gains shapes so cached engine scripts reload. */
const PRESENCE_BALL_REV = '18'

export const COMPANION_SHAPES = [
  'blob',
  'wedge',
  'gem',
  'squircle',
  'drop',
  'pill',
  'petal',
  'loaf',
  'heart',
  'star',
  'hex',
  'egg',
  'cloud',
  'shield',
] as const

export const COMPANION_COLORS = [
  'cream',
  'mist',
  'peach',
  'sage',
  'lilac',
  'slate',
  'coral',
  'butter',
  'mint',
  'sky',
  'rose',
  'cocoa',
  'honey',
  'ocean',
  'grape',
  'blush',
  'sand',
  'ink',
  'ice',
  'matcha',
] as const

export const COMPANION_KITS = [
  'none',
  'bow',
  'cap',
  'beanie',
  'visor',
  'specs',
  'specs-rect',
  'specs-cat',
  'specs-sun',
  'halo',
] as const

export type CompanionShape = (typeof COMPANION_SHAPES)[number]
export type CompanionColor = (typeof COMPANION_COLORS)[number]
export type CompanionKit = (typeof COMPANION_KITS)[number]

const PALETTES: Record<CompanionColor, { light: { body: string; eyes: string }; dark: { body: string; eyes: string } }> = {
  cream: { light: { body: '#F3F0EA', eyes: '#1A1A1A' }, dark: { body: '#E4E0D8', eyes: '#1A1A1A' } },
  mist: { light: { body: '#D4E0EC', eyes: '#1A1A1A' }, dark: { body: '#9AABB8', eyes: '#1A1A1A' } },
  peach: { light: { body: '#F0D8C8', eyes: '#1A1A1A' }, dark: { body: '#C4A090', eyes: '#1A1A1A' } },
  sage: { light: { body: '#D4E5C8', eyes: '#1A1A1A' }, dark: { body: '#96B088', eyes: '#1A1A1A' } },
  lilac: { light: { body: '#E5D4E8', eyes: '#1A1A1A' }, dark: { body: '#B098B8', eyes: '#1A1A1A' } },
  slate: { light: { body: '#C8CDD4', eyes: '#1A1A1A' }, dark: { body: '#5A6068', eyes: '#F0EEE8' } },
  coral: { light: { body: '#F0C8BC', eyes: '#1A1A1A' }, dark: { body: '#C48A7C', eyes: '#1A1A1A' } },
  butter: { light: { body: '#F2E4B0', eyes: '#1A1A1A' }, dark: { body: '#C4B070', eyes: '#1A1A1A' } },
  mint: { light: { body: '#C8E8DC', eyes: '#1A1A1A' }, dark: { body: '#7ABAA8', eyes: '#1A1A1A' } },
  sky: { light: { body: '#C5DCF0', eyes: '#1A1A1A' }, dark: { body: '#7A9BB8', eyes: '#1A1A1A' } },
  rose: { light: { body: '#E8C8D4', eyes: '#1A1A1A' }, dark: { body: '#B8889C', eyes: '#1A1A1A' } },
  cocoa: { light: { body: '#C4A888', eyes: '#1A1A1A' }, dark: { body: '#8A7058', eyes: '#F0EEE8' } },
  honey: { light: { body: '#E8C46A', eyes: '#1A1A1A' }, dark: { body: '#B89040', eyes: '#1A1A1A' } },
  ocean: { light: { body: '#7EB8C8', eyes: '#1A1A1A' }, dark: { body: '#4A8898', eyes: '#F0EEE8' } },
  grape: { light: { body: '#C4B0E0', eyes: '#1A1A1A' }, dark: { body: '#8A78B0', eyes: '#1A1A1A' } },
  blush: { light: { body: '#F0B8C4', eyes: '#1A1A1A' }, dark: { body: '#C88898', eyes: '#1A1A1A' } },
  sand: { light: { body: '#E4D4B8', eyes: '#1A1A1A' }, dark: { body: '#B8A078', eyes: '#1A1A1A' } },
  ink: { light: { body: '#3A3A42', eyes: '#F0EEE8' }, dark: { body: '#2A2A30', eyes: '#F0EEE8' } },
  ice: { light: { body: '#D8EEF2', eyes: '#1A1A1A' }, dark: { body: '#9AB8C0', eyes: '#1A1A1A' } },
  matcha: { light: { body: '#B8D4A0', eyes: '#1A1A1A' }, dark: { body: '#7A9A68', eyes: '#1A1A1A' } },
}

function isCompanionShape(value: string): value is CompanionShape {
  return COMPANION_SHAPES.some((id) => id === value)
}

function isCompanionColor(value: string): value is CompanionColor {
  return COMPANION_COLORS.some((id) => id === value)
}

function isCompanionKit(value: string): value is CompanionKit {
  return COMPANION_KITS.some((id) => id === value)
}

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

type EmotionBallHandle = { destroy: () => void }

type EmotionBallNs = {
  create: (
    el: HTMLElement,
    opts?: {
      emotion?: string
      idle?: boolean
      lite?: boolean
      eyeScale?: number
      shape?: string
      color?: string
      eyeColor?: string
      kit?: string
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
      document.querySelector(`script[data-xrk-presence="${name}"]`)?.remove()
      await new Promise<void>((resolve, reject) => {
        const el = document.createElement('script')
        el.src = `${SCRIPT_BASE}/${name}?v=${PRESENCE_BALL_REV}`
        el.async = false
        el.dataset.xrkPresence = name
        el.onload = () => { resolve() }
        el.onerror = () => { reject(new Error(`failed to load ${name}`)) }
        document.head.appendChild(el)
      })
    }
    document.documentElement.dataset.xrkPresenceRev = PRESENCE_BALL_REV
  })().catch((err) => {
    scriptsPromise = undefined
    throw err
  })
  return scriptsPromise
}

export function companionPaint(color: string, dark: boolean): { body: string; eyes: string } {
  const id = isCompanionColor(color) ? color : 'cream'
  return dark ? PALETTES[id].dark : PALETTES[id].light
}

/** Compact silhouette for the shape picker (same ids as the engine). */
export function CompanionShapeGlyph({ shape }: { readonly shape: string }) {
  const id = isCompanionShape(shape) ? shape : 'blob'
  return (
    <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
      {id === 'wedge' ? (
        <path
          fill="currentColor"
          d="M18 5.5c1.2 0 2.3.6 3 1.6l10.2 15.8c1.4 2.2-.2 5.1-2.8 5.1H7.6c-2.6 0-4.2-2.9-2.8-5.1L15 7.1c.7-1 1.8-1.6 3-1.6z"
        />
      ) : id === 'gem' ? (
        <path fill="currentColor" d="M18 4.5 31.5 18 18 31.5 4.5 18 18 4.5z" />
      ) : id === 'squircle' ? (
        <rect x="6" y="6" width="24" height="24" rx="8" fill="currentColor" />
      ) : id === 'drop' ? (
        <path
          fill="currentColor"
          d="M18 5 27.2 19.4a9.4 9.4 0 1 1-18.4 0Z"
        />
      ) : id === 'pill' ? (
        <rect x="4" y="11" width="28" height="14" rx="7" fill="currentColor" />
      ) : id === 'petal' ? (
        <path
          fill="currentColor"
          d="M18 5c2.4 4.8 4.2 8 6.8 9.3C27.4 15.6 30 16 31 18c-1 2-3.6 2.4-6.2 3.7C22.2 23 20.4 26.2 18 31c-2.4-4.8-4.2-8-6.8-9.3C8.6 20.4 6 20 5 18c1-2 3.6-2.4 6.2-3.7C13.8 13 15.6 9.8 18 5z"
        />
      ) : id === 'loaf' ? (
        <path
          fill="currentColor"
          d="M6.5 16.5c0-5.2 5.2-9.5 11.5-9.5s11.5 4.3 11.5 9.5v7.2c0 2.3-2.3 4.2-5.2 4.2H11.7c-2.9 0-5.2-1.9-5.2-4.2z"
        />
      ) : id === 'heart' ? (
        <path
          fill="currentColor"
          d="M18 30.5 8.2 20.4C4.4 16.6 4.6 10.6 8.8 8.2c2.8-1.6 6.4-.8 8.2 1.8 1.8-2.6 5.4-3.4 8.2-1.8 4.2 2.4 4.4 8.4.6 12.2z"
        />
      ) : id === 'star' ? (
        <path
          fill="currentColor"
          d="M18 5.5 21.4 14l8.8.8-6.7 5.8 2.1 8.6L18 24.4l-7.6 4.8 2.1-8.6-6.7-5.8 8.8-.8z"
        />
      ) : id === 'hex' ? (
        <path fill="currentColor" d="M18 5.5 29 12v12L18 30.5 7 24V12z" />
      ) : id === 'egg' ? (
        <ellipse cx="18" cy="19" rx="10" ry="13" fill="currentColor" />
      ) : id === 'cloud' ? (
        <path
          fill="currentColor"
          d="M12 24h14a6 6 0 0 0 1-12 8 8 0 0 0-15.2-2A6.5 6.5 0 0 0 12 24z"
        />
      ) : id === 'shield' ? (
        <path fill="currentColor" d="M18 5.5 28 9.5v9.2c0 6.2-4.2 10.4-10 12.8-5.8-2.4-10-6.6-10-12.8V9.5z" />
      ) : (
        <circle cx="18" cy="18" r="13.5" fill="currentColor" />
      )}
    </svg>
  )
}

/** Named overlay kit (not a shop). Face sticker stays separate. */
export function CompanionKitMark({
  kit,
  className,
}: {
  readonly kit: CompanionKit
  readonly className?: string
}) {
  const markClass = className ?? css.kit
  if (kit === 'bow') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E07090" d="M7 16c0-4 4-7 7.5-4.5 2 1.5 3 3.5 4.5 5.5 1.5-2 2.5-4 4.5-5.5C27 9 31 12 31 16c0 3-2.2 4.8-5 4.8-2.2 0-4-1.1-5.5-2.8C19 19.7 17.2 20.8 15 20.8 12.2 20.8 7 19 7 16z" />
        <circle cx="18" cy="16.5" r="2.4" fill="#C44868" />
        <circle cx="17.3" cy="15.6" r=".7" fill="#F4A0B4" />
      </svg>
    )
  }
  if (kit === 'cap') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="21" rx="13" ry="2.6" fill="#2A446C" />
        <path fill="#3A5A8C" d="M9 20c0-8 4-13 9-13s9 5 9 13H9z" />
        <path fill="rgba(255,255,255,0.22)" d="M14 14c1-4 3.2-6 4-6 1.2 0 2.8 1.6 4 5.2-2.2-1-4.4-1-8 .8z" />
      </svg>
    )
  }
  if (kit === 'beanie') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M9 22c0-8 4-14 9-14s9 6 9 14H9z" />
        <rect x="8" y="20" width="20" height="4" rx="1.4" fill="#2A446C" />
        <circle cx="18" cy="9.5" r="1.8" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'visor') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="9" y="14" width="18" height="3" rx="1.2" fill="#3A5A8C" />
        <ellipse cx="18" cy="20" rx="12" ry="3" fill="#2A446C" />
      </svg>
    )
  }
  if (kit === 'specs-rect') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="7" y="14" width="9" height="8" rx="1.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <rect x="20" y="14" width="9" height="8" rx="1.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <path d="M16 18h4" fill="none" stroke="#2A2A30" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'specs-cat') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M8 19c0-4 3-7 7-5 1.2-3 4-3 5 0 4-2 7 1 7 5-2 4-5 4-7 2-2 2-5 2-7-2-2 2-5 2-5-2z" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.5" />
      </svg>
    )
  }
  if (kit === 'specs-sun') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="13" cy="18" rx="5.4" ry="4.4" fill="rgba(28,28,32,0.55)" stroke="#4A241C" strokeWidth="1.8" />
        <ellipse cx="23" cy="18" rx="5.4" ry="4.4" fill="rgba(28,28,32,0.55)" stroke="#4A241C" strokeWidth="1.8" />
      </svg>
    )
  }
  if (kit === 'specs') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="13" cy="18" rx="5" ry="4.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <ellipse cx="23" cy="18" rx="5" ry="4.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <path d="M17.4 18H18.6" fill="none" stroke="#2A2A30" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 18.2 5.8 19.4" fill="none" stroke="#2A2A30" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M28 18.2 30.2 19.4" fill="none" stroke="#2A2A30" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'halo') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="10" rx="11" ry="3.2" fill="none" stroke="#E8C46A" strokeWidth="1.8" />
        <ellipse cx="15" cy="9.2" rx="3.6" ry="1.1" fill="none" stroke="#F6E4A0" strokeWidth=".9" opacity=".7" />
      </svg>
    )
  }
  return (
    <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
    </svg>
  )
}

export function CompanionBall({
  shape,
  color,
  kit,
  face,
  empty,
  emotion = '02',
}: {
  readonly shape: string
  readonly color: string
  readonly kit?: string
  readonly face?: string
  readonly empty?: boolean
  readonly emotion?: string
}) {
  const dark = useChromeDark()
  const paint = companionPaint(color, dark)
  const resolvedShape = isCompanionShape(shape) ? shape : 'blob'
  const resolvedKit = kit && isCompanionKit(kit) ? kit : 'none'
  const mountRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef<EmotionBallHandle | null>(null)
  const [ready, setReady] = useState(false)

  const mount = useCallback(() => {
    const el = mountRef.current
    if (!el || empty) return
    let cancelled = false
    void loadEmotionBallScripts().then(
      () => {
        if (cancelled || !mountRef.current || !window.EmotionBall?.create) return
        mountRef.current.replaceChildren()
        ballRef.current = window.EmotionBall.create(mountRef.current, {
          emotion,
          idle: false,
          lite: true,
          eyeScale: 1.15,
          shape: resolvedShape,
          color: paint.body,
          eyeColor: paint.eyes,
          kit: resolvedKit,
        })
        setReady(true)
      },
      () => {
        if (!cancelled) setReady(false)
      },
    )
    return () => {
      cancelled = true
      ballRef.current?.destroy()
      ballRef.current = null
      setReady(false)
    }
  }, [empty, emotion, paint.body, paint.eyes, resolvedShape, resolvedKit])

  useEffect(() => mount(), [mount])

  return (
    <span className={css.stage} data-empty={empty ? '' : undefined} data-face={face ? '' : undefined}>
      {empty ? <span className={css.plus} aria-hidden>+</span> : null}
      {face ? <span className={css.face} style={{ backgroundImage: `url(${face})` }} aria-hidden /> : null}
      <span ref={mountRef} className={css.mount} data-ready={ready && !empty ? '' : undefined} aria-hidden />
    </span>
  )
}
