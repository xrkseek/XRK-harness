/**
 * Presence companion prefs row in Settings → General.
 * Feature-owned (ui-plan); shape + color persist via Host `ui-presence`.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-settings/client'
import {
  PRESENCE_COLORS,
  PRESENCE_COLOR_PALETTES,
  PRESENCE_GLASSES_KITS,
  PRESENCE_HAT_KITS,
  PRESENCE_HELD_KITS,
  PRESENCE_OVERLAY_MAX,
  PRESENCE_SHAPES,
  stickerRef,
  type PresenceColor,
  type PresenceShape,
  type PresenceSticker,
} from '../presence-settings.ts'
import type { createPresencePrefsRowStore } from './presence-settings-store.ts'
import type { DressingSlot } from './presence-settings-runtime.ts'
import { PresenceKitMark } from './PresenceKitMark.tsx'
import { type PlanKey } from './locales.ts'
import css from './PresenceShapeRow.module.css'

/** Injected write face for shape + color pickers. */
export interface PresenceShapeRowInjected {
  setShape: (shape: PresenceShape) => void
  setColor: (color: PresenceColor) => void
  setSlot: (slot: DressingSlot, pick: string) => void
  addSticker: (image: string, slot?: DressingSlot) => string | undefined
  removeSticker: (id: string) => void
}

export type PresenceShapeRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createPresencePrefsRowStore>>
  & PropsLocale<'plan'>
  & PresenceShapeRowInjected

function shapeLabel(id: PresenceShape): PlanKey {
  return `presenceShape.${id}` as PlanKey
}

function colorLabel(id: PresenceColor): PlanKey {
  return `presenceColor.${id}` as PlanKey
}

/** Simple SVG glyphs matching emotion-ball body silhouettes. */
function ShapeGlyph({ shape }: { readonly shape: PresenceShape }) {
  if (shape === 'wedge') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M18 5.5c1.2 0 2.3.6 3 1.6l10.2 15.8c1.4 2.2-.2 5.1-2.8 5.1H7.6c-2.6 0-4.2-2.9-2.8-5.1L15 7.1c.7-1 1.8-1.6 3-1.6z"
        />
      </svg>
    )
  }
  if (shape === 'gem') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path fill="currentColor" d="M18 4.5 31.5 18 18 31.5 4.5 18 18 4.5z" />
      </svg>
    )
  }
  if (shape === 'squircle') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <rect x="6" y="6" width="24" height="24" rx="8" fill="currentColor" />
      </svg>
    )
  }
  if (shape === 'drop') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M18 5 27.2 19.4a9.4 9.4 0 1 1-18.4 0Z"
        />
      </svg>
    )
  }
  if (shape === 'pill') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <rect x="4" y="11" width="28" height="14" rx="7" fill="currentColor" />
      </svg>
    )
  }
  if (shape === 'petal') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M18 5c2.4 4.8 4.2 8 6.8 9.3C27.4 15.6 30 16 31 18c-1 2-3.6 2.4-6.2 3.7C22.2 23 20.4 26.2 18 31c-2.4-4.8-4.2-8-6.8-9.3C8.6 20.4 6 20 5 18c1-2 3.6-2.4 6.2-3.7C13.8 13 15.6 9.8 18 5z"
        />
      </svg>
    )
  }
  if (shape === 'loaf') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M6.5 16.5c0-5.2 5.2-9.5 11.5-9.5s11.5 4.3 11.5 9.5v7.2c0 2.3-2.3 4.2-5.2 4.2H11.7c-2.9 0-5.2-1.9-5.2-4.2z"
        />
      </svg>
    )
  }
  if (shape === 'heart') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M18 30.5 8.2 20.4C4.4 16.6 4.6 10.6 8.8 8.2c2.8-1.6 6.4-.8 8.2 1.8 1.8-2.6 5.4-3.4 8.2-1.8 4.2 2.4 4.4 8.4.6 12.2z"
        />
      </svg>
    )
  }
  if (shape === 'star') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M18 5.5 21.4 14l8.8.8-6.7 5.8 2.1 8.6L18 24.4l-7.6 4.8 2.1-8.6-6.7-5.8 8.8-.8z"
        />
      </svg>
    )
  }
  if (shape === 'hex') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path fill="currentColor" d="M18 5.5 29 12v12L18 30.5 7 24V12z" />
      </svg>
    )
  }
  if (shape === 'egg') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="19" rx="10" ry="13" fill="currentColor" />
      </svg>
    )
  }
  if (shape === 'cloud') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path
          fill="currentColor"
          d="M12 24h14a6 6 0 0 0 1-12 8 8 0 0 0-15.2-2A6.5 6.5 0 0 0 12 24z"
        />
      </svg>
    )
  }
  if (shape === 'shield') {
    return (
      <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
        <path fill="currentColor" d="M18 5.5 28 9.5v9.2c0 6.2-4.2 10.4-10 12.8-5.8-2.4-10-6.6-10-12.8V9.5z" />
      </svg>
    )
  }
  return (
    <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="13.5" fill="currentColor" />
    </svg>
  )
}

function SlotRow({
  t,
  label,
  hint,
  builtins,
  pick,
  stickers,
  onPick,
  onImport,
  onDelete,
  onTooBig,
}: {
  readonly t: PresenceShapeRowComponentProps['t']
  readonly label: string
  readonly hint: string
  readonly builtins: readonly string[]
  readonly pick: string
  readonly stickers: readonly PresenceSticker[]
  readonly onPick: (next: string) => void
  readonly onImport: (image: string) => void
  readonly onDelete: (id: string) => void
  readonly onTooBig: () => void
}) {
  return (
    <div className={css.slot}>
      <div className={css.slotHead}>
        <span className={css.slotLabel}>{label}</span>
        <span className={css.overlayHint}>{hint}</span>
      </div>
      <div className={css.cubeRow}>
        {builtins.map((id) => (
          <button
            key={id}
            type="button"
            className={clsx(css.overlayCube, pick === id && css.selected)}
            aria-pressed={pick === id}
            onClick={() => { onPick(id) }}
          >
            <PresenceKitMark kit={id} className={css.glyph ?? ''} />
            <span className={css.overlayLabel}>{t(`presenceKit.${id}` as PlanKey)}</span>
          </button>
        ))}
        {stickers.map((row) => {
          const ref = stickerRef(row.id)
          return (
            <div key={row.id} className={clsx(css.overlayCube, pick === ref && css.selected)}>
              <button
                type="button"
                className={css.stickerHit}
                aria-pressed={pick === ref}
                onClick={() => { onPick(ref) }}
              >
                <span className={css.overlayPreview} aria-hidden>
                  <span className={css.overlayThumb} style={{ backgroundImage: `url(${row.image})` }} />
                </span>
              </button>
              <button
                type="button"
                className={css.overlayClear}
                aria-label="删除"
                onClick={() => { onDelete(row.id) }}
              >
                ×
              </button>
            </div>
          )
        })}
        <div className={clsx(css.overlayCube, css.overlayAdd)}>
          <span className={css.overlayPreview} aria-hidden>
            <span className={css.overlayEmpty}>+</span>
          </span>
          <input
            className={css.overlayFile}
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
            aria-label={label}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => {
                const next = String(reader.result ?? '')
                if (next.length > PRESENCE_OVERLAY_MAX) {
                  onTooBig()
                  return
                }
                onImport(next)
              }
              reader.readAsDataURL(file)
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** Render the presence shape + color row. */
export function PresenceShapeRow({
  t,
  setShape,
  setColor,
  setSlot,
  addSticker,
  removeSticker,
  useStore,
}: PresenceShapeRowComponentProps) {
  const shape = useStore((s) => s.shape)
  const color = useStore((s) => s.color)
  const kitHat = useStore((s) => s.kitHat)
  const kitGlasses = useStore((s) => s.kitGlasses)
  const kitHeld = useStore((s) => s.kitHeld)
  const stickers = useStore((s) => s.stickers)
  const [overlayErr, setOverlayErr] = useState<string | null>(null)
  const tooBig = t('presenceOverlay.tooBig')
  const markTooBig = () => { setOverlayErr(tooBig) }
  return (
    <div className={css.group}>
      <div className={css.title}>{t('presenceShape.title')}</div>
      <p className={css.hint}>{t('presenceShape.hint')}</p>
      <div className={css.cubeRow}>
        {PRESENCE_SHAPES.map((id) => (
          <button
            key={id}
            type="button"
            className={clsx(css.shapeCube, shape === id && css.selected)}
            aria-pressed={shape === id}
            onClick={() => { setShape(id) }}
          >
            <ShapeGlyph shape={id} />
            {t(shapeLabel(id))}
          </button>
        ))}
      </div>

      <div className={css.subtitle}>{t('presenceColor.title')}</div>
      <p className={css.hint}>{t('presenceColor.hint')}</p>
      <div className={css.cubeRow}>
        {PRESENCE_COLORS.map((id) => {
          const paint = PRESENCE_COLOR_PALETTES[id].light
          return (
            <button
              key={id}
              type="button"
              className={clsx(css.colorCube, color === id && css.selected)}
              aria-pressed={color === id}
              onClick={() => { setColor(id) }}
            >
              <span
                className={css.swatch}
                style={{ background: paint.body, color: paint.eyes }}
                aria-hidden
              >
                <span className={css.swatchEye} />
                <span className={css.swatchEye} />
              </span>
              {t(colorLabel(id))}
            </button>
          )
        })}
      </div>

      <div className={css.subtitle}>{t('presenceKit.title')}</div>
      <p className={css.hint}>{t('presenceKit.hint')}</p>
      {overlayErr ? <p className={css.overlayError} role="alert">{overlayErr}</p> : null}
      <SlotRow
        t={t}
        label={t('presenceOverlay.hat')}
        hint={t('presenceOverlay.hatHint')}
        builtins={PRESENCE_HAT_KITS}
        pick={kitHat}
        stickers={stickers.filter((row) => row.slot === 'hat')}
        onPick={(next) => { setOverlayErr(null); setSlot('hat', next) }}
        onImport={(image) => { setOverlayErr(null); addSticker(image, 'hat') }}
        onDelete={removeSticker}
        onTooBig={markTooBig}
      />
      <SlotRow
        t={t}
        label={t('presenceOverlay.glasses')}
        hint={t('presenceOverlay.glassesHint')}
        builtins={PRESENCE_GLASSES_KITS}
        pick={kitGlasses}
        stickers={stickers.filter((row) => row.slot === 'glasses')}
        onPick={(next) => { setOverlayErr(null); setSlot('glasses', next) }}
        onImport={(image) => { setOverlayErr(null); addSticker(image, 'glasses') }}
        onDelete={removeSticker}
        onTooBig={markTooBig}
      />
      <SlotRow
        t={t}
        label={t('presenceOverlay.held')}
        hint={t('presenceOverlay.heldHint')}
        builtins={PRESENCE_HELD_KITS}
        pick={kitHeld}
        stickers={stickers.filter((row) => row.slot === 'held')}
        onPick={(next) => { setOverlayErr(null); setSlot('held', next) }}
        onImport={(image) => { setOverlayErr(null); addSticker(image, 'held') }}
        onDelete={removeSticker}
        onTooBig={markTooBig}
      />
    </div>
  )
}
