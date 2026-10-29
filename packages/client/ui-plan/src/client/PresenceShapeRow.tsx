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
  PRESENCE_TITLE_SCHEMES,
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
  addStatusPreset,
  removeStatusPreset,
  setTitleScheme,
  setSeatTitle,
  useStore,
}: PresenceShapeRowComponentProps) {
  const enabled = useStore((s) => s.enabled)
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
