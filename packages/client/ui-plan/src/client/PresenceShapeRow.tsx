/**
 * Presence companion prefs row in Settings → General.
 * Feature-owned (ui-plan); shape + color persist via Host `ui-presence`.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-settings/client'
import {
  PRESENCE_COLORS,
  PRESENCE_COLOR_PALETTES,
  PRESENCE_SHAPES,
  type PresenceColor,
  type PresenceShape,
} from '../presence-settings.ts'
import type { createPresencePrefsRowStore } from './presence-settings-store.ts'
import css from './PresenceShapeRow.module.css'

/** Injected write face for shape + color pickers. */
export interface PresenceShapeRowInjected {
  setShape: (shape: PresenceShape) => void
  setColor: (color: PresenceColor) => void
}

export type PresenceShapeRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createPresencePrefsRowStore>>
  & PropsLocale<'plan'>
  & PresenceShapeRowInjected

const SHAPE_LABELS: Record<
  PresenceShape,
  'presenceShape.blob' | 'presenceShape.wedge' | 'presenceShape.gem'
> = {
  blob: 'presenceShape.blob',
  wedge: 'presenceShape.wedge',
  gem: 'presenceShape.gem',
}

const COLOR_LABELS: Record<
  PresenceColor,
  | 'presenceColor.cream'
  | 'presenceColor.mist'
  | 'presenceColor.peach'
  | 'presenceColor.sage'
  | 'presenceColor.lilac'
  | 'presenceColor.slate'
> = {
  cream: 'presenceColor.cream',
  mist: 'presenceColor.mist',
  peach: 'presenceColor.peach',
  sage: 'presenceColor.sage',
  lilac: 'presenceColor.lilac',
  slate: 'presenceColor.slate',
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
        <path
          fill="currentColor"
          d="M18 4.5 31.5 18 18 31.5 4.5 18 18 4.5z"
        />
      </svg>
    )
  }
  return (
    <svg className={css.glyph} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="13.5" fill="currentColor" />
    </svg>
  )
}

/** Render the presence shape + color row. */
export function PresenceShapeRow({
  t,
  setShape,
  setColor,
  useStore,
}: PresenceShapeRowComponentProps) {
  const shape = useStore((s) => s.shape)
  const color = useStore((s) => s.color)
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
            {t(SHAPE_LABELS[id])}
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
              {t(COLOR_LABELS[id])}
            </button>
          )
        })}
      </div>
    </div>
  )
}
