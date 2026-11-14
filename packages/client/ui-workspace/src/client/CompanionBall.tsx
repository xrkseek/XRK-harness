/**
 * Compact EmotionBall mount for Agent Team — same engine as the session header.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import css from './CompanionBall.module.css'
import { SHAPE_GLYPHS } from './shape-glyphs.ts'
import { BRAND_BADGES } from './brand-badges.ts'
import {
  COMPANION_COLORS,
  COMPANION_KITS,
  COMPANION_SHAPES,
  HELD_BUILTINS,
  companionPaint,
  isCompanionColor,
  isCompanionKit,
  isCompanionShape,
  isHeldBuiltin,
} from './dressing-library.ts'
import type {
  CompanionColor,
  CompanionHeld,
  CompanionKit,
  CompanionShape,
} from './dressing-library.ts'

/* Re-export the look vocabulary so existing importers (TeamRoster,
 * AddAgentPanel, rows) keep importing it from CompanionBall. */
export {
  COMPANION_COLORS,
  COMPANION_KITS,
  COMPANION_SHAPES,
  companionPaint,
  isCompanionColor,
  isCompanionKit,
  isCompanionShape,
}
export type { CompanionColor, CompanionHeld, CompanionKit, CompanionShape }

const SCRIPT_BASE = '/presence/emotion-ball'
const SCRIPT_ORDER = ['rings.js', 'emotions.js', 'ball.js', 'engine.js'] as const
/** Bump when rings.js gains shapes so cached engine scripts reload. */
const PRESENCE_BALL_REV = '43'

/** Free-form override guard — the picker yields exactly `#rrggbb`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/


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

type DressingImages = {
  readonly hat?: string
  readonly glasses?: string
  readonly held?: string
}

type EmotionBallHandle = {
  destroy: () => void
  setLite?: (on: boolean) => void
  setDressing?: (hat: string, glasses: string, held?: string, images?: string | DressingImages) => void
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
      color?: string
      eyeColor?: string
      kit?: string
      kitHat?: string
      kitGlasses?: string
      kitHeld?: string
      /** 三槽贴图：进引擎层，跟随呼吸/转头/形变。DOM 绝对定位层已废弃。 */
      hatImage?: string
      glassesImage?: string
      heldImage?: string
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


/**
 * Compact silhouette for the shape picker. The path comes straight from
 * `shape-glyphs.ts`, which `scripts/gen-shape-glyphs.mjs` generates from the
 * engine's own `rings.js` rings — never hand-draw a second outline here.
 */
export function CompanionShapeGlyph({ shape }: { readonly shape: string }) {
  const id = isCompanionShape(shape) ? shape : 'blob'
  return (
    <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
      <path fill="currentColor" d={SHAPE_GLYPHS[id] ?? SHAPE_GLYPHS.blob} />
    </svg>
  )
}

/** Named overlay kit (not a shop). Face sticker stays separate. */
export function CompanionKitMark({
  kit,
  className,
}: {
  readonly kit: CompanionKit | CompanionHeld
  readonly className?: string
}) {
  const markClass = className ?? css.kit
  /* 品牌手持：牌面就是引擎渲染的那张（rings.js BRANDS → brand-badges.ts）。 */
  const badge = BRAND_BADGES[kit]
  if (badge) {
    const glyph = badge.glyphColor ?? '#FFFFFF'
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="4" y="4" width="28" height="28" rx="8" fill={badge.color} />
        <path fill={glyph} d={badge.path} transform="translate(4 4) scale(1.1667)" />
        {/* Two-tone brands (XRK's gold drop) stack a second path on the same grid. */}
        {badge.accent ? (
          <path
            fill={badge.accentColor ?? glyph}
            d={badge.accent}
            transform="translate(4 4) scale(1.1667)"
          />
        ) : null}
      </svg>
    )
  }
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
  if (kit === 'bucket') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M11 18c0-6 3-10 7-10s7 4 7 10z" />
        <rect x="11" y="16.4" width="14" height="3" fill="#C44868" />
        <path fill="#2A446C" d="M5 18c1.4 5 6.6 8 13 8s11.6-3 13-8c-4.4 3-8.6 4.4-13 4.4S9.4 21 5 18z" />
      </svg>
    )
  }
  if (kit === 'beret') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18.6" cy="17" rx="13" ry="7.4" fill="#3A5A8C" transform="rotate(-9 18.6 17)" />
        <path d="M7.4 19.4c4.4 3.6 17.6 4.2 22.4-1.4" fill="none" stroke="#2A446C" strokeWidth="3.4" strokeLinecap="round" />
        <circle cx="26.4" cy="10.6" r="2.6" fill="#C44868" />
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
  if (kit === 'flower') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="14" r="3.2" fill="#F4A0B4" />
        <circle cx="12.5" cy="17.5" r="3.2" fill="#E07090" />
        <circle cx="23.5" cy="17.5" r="3.2" fill="#E07090" />
        <circle cx="15" cy="23" r="3.2" fill="#E07090" />
        <circle cx="21" cy="23" r="3.2" fill="#E07090" />
        <circle cx="18" cy="19" r="2.4" fill="#E8C46A" />
        <path d="M18 22 v8" fill="none" stroke="#6A9A68" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'tea') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M10 16h14l-1.4 10.5c-.2 1.4-1.4 2.5-2.8 2.5H14.2c-1.4 0-2.6-1.1-2.8-2.5Z" fill="#E8D8C8" stroke="#8A7058" strokeWidth="1.4" />
        <path d="M24 18.5c3 .4 5 2.2 5 4.2s-2 3.6-5 4" fill="none" stroke="#8A7058" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 13c.6-2 2.2-3 4-3 1.6 0 3 .8 3.6 2" fill="none" stroke="#9AB8C0" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'flag') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M12 8 v20" fill="none" stroke="#5A6068" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M13 9 l14 5-14 5Z" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'spark') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E8C46A" d="M18 7 20.2 15l8 .8-6.2 5.2 1.8 7.8L18 24.4 12.2 28.8l1.8-7.8-6.2-5.2 8-.8z" />
      </svg>
    )
  }
  /* ---- 帽子：crown / tophat / chef / party / straw / wizard / cat-ears /
   * headphones / antenna / flower-crown / cake ---- */
  if (kit === 'crown') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M8 24V12l5.5 5L18 10l4.5 7L28 12v12z" />
        <rect x="7.6" y="22" width="20.8" height="3.4" rx="1.2" fill="#2A446C" />
        <circle cx="18" cy="10" r="1.3" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'tophat') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="25" rx="12.5" ry="2.6" fill="#2A446C" />
        <rect x="11" y="8" width="14" height="17" rx="1.6" fill="#3A5A8C" />
        <rect x="11" y="20.4" width="14" height="3" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'chef') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <circle cx="12.5" cy="15" r="4.4" fill="#F2EDE4" />
        <circle cx="23.5" cy="15" r="4.4" fill="#F2EDE4" />
        <circle cx="18" cy="11.6" r="5.2" fill="#FBF7F0" />
        <rect x="11" y="19" width="14" height="6" rx="1.4" fill="#E4DCCE" />
      </svg>
    )
  }
  if (kit === 'party') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M18 7 26 26H10z" />
        <path fill="#C44868" d="M14.6 17h6.8l1 3.4h-8.8z" />
        <circle cx="18" cy="7" r="2" fill="#E8C46A" />
      </svg>
    )
  }
  if (kit === 'straw') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="22" rx="14" ry="3.4" fill="#2A446C" />
        <path fill="#3A5A8C" d="M10 22c0-6 3.6-10 8-10s8 4 8 10z" />
        <rect x="10" y="18.6" width="16" height="2.2" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'wizard') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="25" rx="11" ry="2.6" fill="#2A446C" />
        <path fill="#3A5A8C" d="M12 25c1.6-7 5-14 11-18-2 5 0 12 2 18z" />
        <path fill="#E8C46A" d="M19.6 12.6 20.8 15l2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" />
      </svg>
    )
  }
  if (kit === 'cat-ears') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M7 24 9.5 9 17 20z" />
        <path fill="#3A5A8C" d="M29 24 26.5 9 19 20z" />
        <rect x="9" y="20" width="18" height="4" rx="1.6" fill="#2A446C" />
        <path fill="#C44868" d="M10.6 14 11.8 20h3z" />
        <path fill="#C44868" d="M25.4 14 24.2 20h-3z" />
      </svg>
    )
  }
  if (kit === 'headphones') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M9 22a9 9 0 0 1 18 0" fill="none" stroke="#2A2A30" strokeWidth="2.6" strokeLinecap="round" />
        <rect x="6.6" y="17" width="4.6" height="9" rx="2.2" fill="#3A5A8C" />
        <rect x="24.8" y="17" width="4.6" height="9" rx="2.2" fill="#3A5A8C" />
      </svg>
    )
  }
  if (kit === 'antenna') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M18 24V13" fill="none" stroke="#2A2A30" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="18" cy="10" r="3.2" fill="#C44868" />
        <rect x="12" y="23" width="12" height="3.4" rx="1.6" fill="#3A5A8C" />
      </svg>
    )
  }
  if (kit === 'flower-crown') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M6 24q12-12 24 0" fill="none" stroke="#3A5A8C" strokeWidth="2" strokeLinecap="round" />
        <circle cx="9.5" cy="21.5" r="2.8" fill="#F4A0B4" />
        <circle cx="18" cy="15" r="2.8" fill="#F4A0B4" />
        <circle cx="26.5" cy="21.5" r="2.8" fill="#F4A0B4" />
        <circle cx="9.5" cy="21.5" r="1" fill="#E8C46A" />
        <circle cx="18" cy="15" r="1" fill="#E8C46A" />
        <circle cx="26.5" cy="21.5" r="1" fill="#E8C46A" />
      </svg>
    )
  }
  if (kit === 'cake') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="8" y="18" width="20" height="9" rx="1.6" fill="#FBF6EC" stroke="rgba(120,96,70,0.28)" />
        <path fill="#FFFBF3" d="M8 19c1.6 2.6 3.4-1.4 5 0s3.4 2.6 5 0 3.4-2.6 5 0 3.4 2.6 5 0v-2.4H8z" />
        <rect x="17.2" y="9" width="1.8" height="8" rx=".8" fill="#F2E6D2" />
        <path fill="#C44868" d="M18 4.6c2.6 3 3.2 4.6 0 6.2-3.2-1.6-2.6-3.2 0-6.2z" />
      </svg>
    )
  }
  /* ---- 眼镜新增：round-xl / oval / square / half / rimless / monocle /
   * heart / shades ---- */
  if (kit === 'specs-round-xl') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <circle cx="12.5" cy="18" r="6.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <circle cx="23.5" cy="18" r="6.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <path d="M18.7 18h-.4" stroke="#2A2A30" strokeWidth="1.7" />
      </svg>
    )
  }
  if (kit === 'specs-oval') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="12.5" cy="18" rx="6" ry="3.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.3" />
        <ellipse cx="23.5" cy="18" rx="6" ry="3.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.3" />
        <path d="M18.5 18h-1" stroke="#2A2A30" strokeWidth="1.3" />
      </svg>
    )
  }
  if (kit === 'specs-square') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="6.5" y="14" width="10" height="8" rx="1.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <rect x="19.5" y="14" width="10" height="8" rx="1.2" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <path d="M16.5 18h3" stroke="#2A2A30" strokeWidth="1.5" />
      </svg>
    )
  }
  if (kit === 'specs-half') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M6.5 18a5.5 5.5 0 0 1 11 0z" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.6" />
        <path d="M18.5 18a5.5 5.5 0 0 1 11 0z" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.6" />
        <path d="M17.5 18h1" stroke="#2A2A30" strokeWidth="1.6" />
      </svg>
    )
  }
  if (kit === 'specs-rimless') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="12.5" cy="18" rx="5.6" ry="4.4" fill="rgba(200,220,240,0.22)" />
        <ellipse cx="23.5" cy="18" rx="5.6" ry="4.4" fill="rgba(200,220,240,0.22)" />
        <path d="M18.1 18h-.2M6.9 17l-2 1.4M29.1 17l2 1.4" fill="none" stroke="#2A2A30" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'specs-monocle') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <circle cx="20" cy="16" r="6" fill="rgba(255,255,255,0.16)" stroke="#2A2A30" strokeWidth="1.8" />
        <path d="M24.4 20.6c2.6 2 1.6 5-1.4 6.6" fill="none" stroke="#C8A24A" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'specs-heart') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path d="M12.6 21.4c-3.2-2-3-6.6 0-6.6 1 0 1.4.7 1.4 1.2 0-.5.4-1.2 1.4-1.2 3 0 3.2 4.6 0 6.6-1 .6-1.8.6-2.8 0z" fill="rgba(255,255,255,0.16)" stroke="#2A2A30" strokeWidth="1.3" />
        <path d="M23.4 21.4c-3.2-2-3-6.6 0-6.6 1 0 1.4.7 1.4 1.2 0-.5.4-1.2 1.4-1.2 3 0 3.2 4.6 0 6.6-1 .6-1.8.6-2.8 0z" fill="rgba(255,255,255,0.16)" stroke="#2A2A30" strokeWidth="1.3" />
      </svg>
    )
  }
  if (kit === 'specs-shades') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="5.6" y="14.6" width="24.8" height="1.8" rx=".9" fill="#2A2A30" />
        <path d="M6.4 16.6h23.2l-1.4 3.4c-.6 1.4-2 2.2-3.4 2.2h-3.2c-1.6 0-3-.9-3.6-2.4-.4-1-1.6-1-2 0-.6 1.5-2 2.4-3.6 2.4h-3.2c-1.4 0-2.8-.8-3.4-2.2z" fill="rgba(40,44,52,0.82)" />
      </svg>
    )
  }
  /* ---- 手持新增：book / pencil / lamp / umbrella / icecream / guitar /
   * camera / balloon ---- */
  if (kit === 'book') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="8" y="10" width="20" height="16" rx="1.6" fill="#B8506E" />
        <rect x="11.6" y="13" width="14" height="10" rx="1" fill="#FBF6EC" />
        <rect x="8" y="10" width="3.6" height="16" rx="1.6" fill="#8A2E48" />
      </svg>
    )
  }
  if (kit === 'pencil') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E8C46A" d="M15 9h6v15l-3 5-3-5z" />
        <path fill="#F2A0B4" d="M15 9h6v-2.6l-3-2-3 2z" />
        <path fill="#E8D8C8" d="M15 24l3 5 3-5z" />
      </svg>
    )
  }
  if (kit === 'lamp') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="15" r="6.4" fill="#F6E08A" />
        <path d="M15.6 18.4l2.4-4 2.4 4" fill="none" stroke="#E8C46A" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="14.4" y="21.4" width="7.2" height="3" rx="1.2" fill="#9AA0A8" />
        <path fill="#7A8088" d="M13 26h10l-1.6 2.6h-6.8z" />
      </svg>
    )
  }
  if (kit === 'umbrella') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#6A90C8" d="M6 19a12 8 0 0 1 24 0z" />
        <path d="M18 19v8a3 3 0 0 0 6 0" fill="none" stroke="#8A7058" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 8v3" fill="none" stroke="#8A7058" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'icecream') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E8C46A" d="M12.5 18h11l-5.5 11z" />
        <circle cx="15" cy="15" r="4.2" fill="#F4A0B4" />
        <circle cx="21" cy="15" r="4.2" fill="#F6C8D4" />
        <circle cx="18" cy="10.4" r="4" fill="#FFF3E0" />
      </svg>
    )
  }
  if (kit === 'guitar') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="16" y="6" width="3.4" height="9" rx="1.2" fill="#8A5A32" />
        <ellipse cx="17.7" cy="19" rx="5.4" ry="4.4" fill="#C4885A" />
        <ellipse cx="17.7" cy="25.6" rx="7" ry="5.4" fill="#C4885A" />
        <circle cx="17.7" cy="23.4" r="2" fill="#3A2A20" />
      </svg>
    )
  }
  if (kit === 'camera') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <rect x="12" y="9.6" width="8" height="3.4" rx="1" fill="#4A4E56" />
        <rect x="7" y="12.4" width="22" height="13" rx="2.2" fill="#4A4E56" />
        <circle cx="18" cy="19" r="5" fill="#2A2E34" />
        <circle cx="18" cy="19" r="2.4" fill="#7AB8D8" />
        <circle cx="25" cy="15.6" r="1.2" fill="#E8C46A" />
      </svg>
    )
  }
  if (kit === 'balloon') {
    return (
      <svg className={markClass} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="15" rx="7" ry="8.4" fill="#E07090" />
        <path fill="#C44868" d="M16.6 23.4h2.8L18 25.6z" />
        <path d="M18 25.6c3 2.4-3 3.6 0 6" fill="none" stroke="#8A7058" strokeWidth="1.1" strokeLinecap="round" />
        <ellipse cx="15.4" cy="11.8" rx="1.8" ry="2.4" fill="rgba(255,255,255,0.4)" />
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
  kitHat,
  kitGlasses,
  kitHeld,
  overlayHat,
  overlayGlasses,
  overlayHeld,
  face,
  empty,
  compact,
  preview,
  emotion = '02',
  bodyColor,
  eyeColor,
  size,
}: {
  readonly shape: string
  readonly color: string
  /** `#rrggbb` override for the body; empty/absent follows `color`'s palette. */
  readonly bodyColor?: string
  /** `#rrggbb` override for the eyes; empty/absent follows `color`'s palette. */
  readonly eyeColor?: string
  /** Ball trim 0.8–1.2 (1 = default). Scales the ball inside a fixed stage. */
  readonly size?: number
  readonly kit?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
  readonly overlayHat?: string
  readonly overlayGlasses?: string
  readonly overlayHeld?: string
  /** @deprecated hat alias */
  readonly face?: string
  readonly empty?: boolean
  /** 18px glyph for sidebar workspace rows. */
  readonly compact?: boolean
  /** Larger stage for the Agent Team look preview card. */
  readonly preview?: boolean
  readonly emotion?: string
}) {
  const dark = useChromeDark()
  const paint = companionPaint(color, dark)
  const bodyPaint = HEX_COLOR.test(bodyColor ?? '') ? (bodyColor as string) : paint.body
  const eyePaint = HEX_COLOR.test(eyeColor ?? '') ? (eyeColor as string) : paint.eyes
  const resolvedShape = isCompanionShape(shape) ? shape : 'blob'
  const resolvedHat = kitHat && isCompanionKit(kitHat) ? kitHat : (kit && !kit.startsWith('specs') && isCompanionKit(kit) ? kit : 'none')
  const resolvedGlasses = kitGlasses && isCompanionKit(kitGlasses)
    ? kitGlasses
    : (kit && kit.startsWith('specs') && isCompanionKit(kit) ? kit : 'none')
  const heldBuiltin = kitHeld && isHeldBuiltin(kitHeld) ? kitHeld : undefined
  const mountRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef<EmotionBallHandle | null>(null)
  const [ready, setReady] = useState(false)
  /* The engine draws at 100% of the stage; the stage keeps its box and the ball
   * is scaled inside it (see `.mount`), so a trim never reflows its neighbours. */
  const ballSize = typeof size === 'number' && Number.isFinite(size)
    ? Math.min(1.2, Math.max(0.8, Math.round(size * 50) / 50))
    : 1

  // Remount for body geometry only; dressing uses setDressing below.
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
          color: bodyPaint,
          eyeColor: eyePaint,
          kitHat: resolvedHat,
          kitGlasses: resolvedGlasses,
          kitHeld: heldBuiltin ?? 'none',
          hatImage: (overlayHat || face) ?? '',
          glassesImage: overlayGlasses ?? '',
          heldImage: overlayHeld ?? '',
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
    // Initial dressing is baked into create(); later kit/overlay swaps go through setDressing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, emotion, bodyPaint, eyePaint, resolvedShape])

  useEffect(() => mount(), [mount])

  useEffect(() => {
    const ball = ballRef.current
    if (!ball || !ready || empty) return
    ball.setDressing?.(resolvedHat, resolvedGlasses, heldBuiltin ?? 'none', {
      hat: (overlayHat || face) ?? '',
      glasses: overlayGlasses ?? '',
      held: overlayHeld ?? '',
    })
  }, [ready, empty, resolvedHat, resolvedGlasses, heldBuiltin, overlayHat, overlayGlasses, overlayHeld, face])

  return (
    <span
      className={css.stage}
      style={ballSize === 1 ? undefined : ({ '--ball-size': String(ballSize) } as CSSProperties)}
      data-empty={empty ? '' : undefined}
      data-compact={compact ? '' : undefined}
      data-preview={preview ? '' : undefined}
    >
      {empty ? <span className={css.plus} aria-hidden>+</span> : null}
      <span ref={mountRef} className={css.mount} data-ready={ready && !empty ? '' : undefined} aria-hidden />
      {/* 装扮贴图全部进引擎层（hatG/specsG/heldG）：按轮廓与眼球锚点逐帧布局，
          所以呼吸、转头、情绪形变都会带着走。DOM 覆盖层做不到这点，已移除。 */}
    </span>
  )
}
