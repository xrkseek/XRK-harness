/**
 * Presence companion card on Plugins home (Host `ui-presence`).
 * Master switch + seat titles + tip presets live here; Boss 装扮
 * (shape / color / kit) is edited in 干员团队.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-settings/client'
import type {} from '@xrkseek/client-ui-settings-plugins/client'
import { IconSparkleRegular, Switch } from '@xrkseek/client-ui-primitives'
import {
  PRESENCE_SEAT_TITLE_MAX,
  PRESENCE_SIZE_MAX,
  PRESENCE_SIZE_MIN,
  PRESENCE_SIZE_STEP,
  PRESENCE_TITLE_SCHEMES,
  PRESENCE_COLOR_PALETTES,
  resolveSeatTitles,
  seatTitlesForScheme,
  type PresenceColor,
  type PresenceShape,
  type PresenceTitleSchemeId,
} from '../presence-settings.ts'
import type { createPresencePrefsRowStore } from './presence-settings-store.ts'
import type { DressingSlot } from './presence-settings-runtime.ts'
import { getPresenceUiLocale } from './PresenceBall.tsx'
import { type PlanKey } from './locales.ts'
import css from './PresenceShapeRow.module.css'

type SeatKey = 'boss' | 'manager' | 'agent'

/** Injected write face — dress setters remain for Host sync; UI moved to Team. */
export interface PresenceShapeRowInjected {
  setEnabled: (enabled: boolean) => void
  setShape: (shape: PresenceShape) => void
  setColor: (color: PresenceColor) => void
  setBodyColor: (hex: string) => void
  setEyeColor: (hex: string) => void
  setSize: (size: number) => void
  setSlot: (slot: DressingSlot, pick: string) => void
  addSticker: (image: string, slot?: DressingSlot) => string | undefined
  removeSticker: (id: string) => void
  addStatusPreset: (tip: string) => boolean
  removeStatusPreset: (tip: string) => void
  setTitleScheme: (scheme: PresenceTitleSchemeId) => void
  setSeatTitle: (seat: 'boss' | 'manager' | 'agent', raw: string) => void
}

export type PresenceShapeRowComponentProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsStore<ReturnType<typeof createPresencePrefsRowStore>>
  & PropsLocale<'plan'>
  & PresenceShapeRowInjected

/** Render the presence module card (switch · titles · tip presets). */
export function PresenceShapeRow({
  t,
  setEnabled,
  setBodyColor,
  setEyeColor,
  setSize,
  addStatusPreset,
  removeStatusPreset,
  setTitleScheme,
  setSeatTitle,
  useStore,
}: PresenceShapeRowComponentProps) {
  const enabled = useStore((s) => s.enabled)
  const color = useStore((s) => s.color)
  const bodyColor = useStore((s) => s.bodyColor)
  const eyeColor = useStore((s) => s.eyeColor)
  const size = useStore((s) => s.size)
  const statusPresets = useStore((s) => s.statusPresets)
  const titleScheme = useStore((s) => s.titleScheme)
  const titleBoss = useStore((s) => s.titleBoss)
  const titleManager = useStore((s) => s.titleManager)
  const titleAgent = useStore((s) => s.titleAgent)
  const uiLocale = getPresenceUiLocale()
  const liveTitles = resolveSeatTitles({
    titleScheme,
    titleBoss,
    titleManager,
    titleAgent,
    locale: uiLocale,
  })
  const customBySeat: Record<SeatKey, string> = {
    boss: titleBoss,
    manager: titleManager,
    agent: titleAgent,
  }
  const [presetDraft, setPresetDraft] = useState('')
  const [open, setOpen] = useState(enabled)
  /* 预设色板取亮色档当基线；覆盖值存在时直接用它。 */
  const presetPaint = (PRESENCE_COLOR_PALETTES[color] ?? PRESENCE_COLOR_PALETTES.cream).light
  const bodyPaint = bodyColor || presetPaint.body
  const eyePaint = eyeColor || presetPaint.eyes
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <div className={css.header}>
        <button
          type="button"
          className={css.headerMain}
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.icon} aria-hidden="true">
            <IconSparkleRegular size={16} />
          </span>
          <span className={css.headText}>
            <span className={css.name}>{t('presenceEnabled.title')}</span>
            <span className={css.description}>{t('presenceEnabled.hint')}</span>
          </span>
        </button>
        <Switch
          checked={enabled}
          aria-label={t('presenceEnabled.title')}
          onCheckedChange={(next) => {
            setEnabled(next)
            if (next) setOpen(true)
          }}
        />
      </div>

      {/* Seat titles are product prefs — not gated by the appearance switch. */}
      <div className={css.body}>
        <p className={css.liveBanner} role="note">{t('presenceLive.banner')}</p>
        <p className={css.hint}>{t('presenceDress.teamHint', { boss: liveTitles.boss })}</p>
        {/* 自定义取色：空值 = 跟随预设色板（点预设色即清空覆盖）。 */}
        <div className={css.subtitle}>{t('presenceCustom.title')}</div>
        <p className={css.hint}>{t('presenceCustom.hint')}</p>
        <div className={css.colorRow}>
          <label className={css.colorPick}>
            <input
              type="color"
              className={css.colorInput}
              value={bodyPaint}
              aria-label={t('presenceCustom.body')}
              onChange={(e) => { setBodyColor(e.target.value) }}
            />
            <span className={css.colorSwatch} style={{ background: bodyPaint }} aria-hidden="true" />
            <span className={css.colorLabel}>{t('presenceCustom.body')}</span>
          </label>
          <label className={css.colorPick}>
            <input
              type="color"
              className={css.colorInput}
              value={eyePaint}
              aria-label={t('presenceCustom.eyes')}
              onChange={(e) => { setEyeColor(e.target.value) }}
            />
            <span className={css.colorSwatch} style={{ background: eyePaint }} aria-hidden="true" />
            <span className={css.colorLabel}>{t('presenceCustom.eyes')}</span>
          </label>
          {bodyColor || eyeColor ? (
            <button
              type="button"
              className={css.colorReset}
              onClick={() => {
                setBodyColor('')
                setEyeColor('')
              }}
            >
              {t('presenceCustom.followPreset')}
            </button>
          ) : null}
        </div>
        {/* 表情球大小：舞台盒子固定，只缩里面的球（0.8–1.2 微调），
            放大时才不会盖住隔壁卡片、也不会把邻居推开。 */}
        <label className={css.sizeRow}>
          <span className={css.colorLabel}>{t('presenceCustom.size')}</span>
          <input
            type="range"
            className={css.sizeRange}
            min={PRESENCE_SIZE_MIN}
            max={PRESENCE_SIZE_MAX}
            step={PRESENCE_SIZE_STEP}
            value={size}
            aria-label={t('presenceCustom.size')}
            onChange={(e) => { setSize(Number(e.target.value)) }}
          />
          <span className={css.sizeValue}>{Math.round(size * 100)}%</span>
        </label>
        <div className={css.subtitle}>{t('titleScheme.title')}</div>
        <p className={css.hint}>{t('titleScheme.hint')}</p>
        <div className={css.cubeRow} role="listbox" aria-label={t('titleScheme.title')}>
          {PRESENCE_TITLE_SCHEMES.map((id) => {
            const titles = seatTitlesForScheme(id, uiLocale)
            const selected = titleScheme === id
              && !titleBoss
              && !titleManager
              && !titleAgent
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className={clsx(css.shapeCube, selected && css.selected)}
                onClick={() => { setTitleScheme(id) }}
              >
                <span className={css.schemeName}>{t(`titleScheme.${id}` as PlanKey)}</span>
                <span className={css.schemeTrio}>
                  {titles.boss} · {titles.manager} · {titles.agent}
                </span>
              </button>
            )
          })}
        </div>
        <p className={css.hint}>{t('titleScheme.customHint')}</p>
        <div className={css.titleFields}>
          {([
            ['boss', t('titleScheme.boss'), liveTitles.boss],
            ['manager', t('titleScheme.manager'), liveTitles.manager],
            ['agent', t('titleScheme.agent'), liveTitles.agent],
          ] as const).map(([seat, label, fallback]) => (
            <label key={seat} className={css.titleField}>
              <span className={css.titleFieldLabel}>{label}</span>
              <input
                className={css.titleFieldInput}
                value={customBySeat[seat]}
                maxLength={PRESENCE_SEAT_TITLE_MAX}
                placeholder={fallback}
                aria-label={label}
                onChange={(e) => { setSeatTitle(seat, e.target.value) }}
              />
            </label>
          ))}
        </div>
      </div>

      {!open || !enabled ? null : (
        <div className={css.body}>
          <div className={css.subtitle}>{t('bossStatus.presetsTitle', { boss: liveTitles.boss })}</div>
          <p className={css.hint}>{t('bossStatus.presetsSettingsHint', { boss: liveTitles.boss })}</p>
          <div className={css.presetEditRow}>
            {statusPresets.map((tip) => (
              <span key={tip} className={css.presetEditChip}>
                <span>{tip}</span>
                <button
                  type="button"
                  className={css.presetEditRemove}
                  aria-label={t('bossStatus.removePreset')}
                  onClick={() => { removeStatusPreset(tip) }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className={css.presetAddRow}>
            <input
              className={css.presetAddInput}
              value={presetDraft}
              maxLength={40}
              placeholder={t('bossStatus.addPresetPlaceholder')}
              aria-label={t('bossStatus.addPresetPlaceholder')}
              onChange={(e) => { setPresetDraft(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (addStatusPreset(presetDraft)) setPresetDraft('')
              }}
            />
            <button
              type="button"
              className={css.presetAddBtn}
              onClick={() => {
                if (addStatusPreset(presetDraft)) setPresetDraft('')
              }}
            >
              {t('bossStatus.addPreset')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
