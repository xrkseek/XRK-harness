/**
 * Overview popover: set the operator (Boss) mood + status line from live
 * `ui-presence` prefs. Tip chips come from Plugins → 表情球 presets.
 *
 * Nickname lives in 干员团队 seats — this sheet only covers mood / tip.
 * Tip commit on Save, blur, or Enter (hot Settings write).
 */
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BOSS_QUICK_MOOD_IDS,
  PRESENCE_STATUS_LINE_MAX,
} from '../presence-settings.ts'
import {
  getPresenceSettingsRuntime,
  useBossMood,
  useSeatTitles,
} from './PresenceBall.tsx'
import type { PlanKey } from './locales.ts'
import css from './BossStatusSheet.module.css'

export function BossStatusSheet({
  open,
  onClose,
  t,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly t: (key: PlanKey, params?: Record<string, string>) => string
}) {
  const boss = useBossMood()
  const seatTitles = useSeatTitles()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(boss.statusLine)
  const [savedFlash, setSavedFlash] = useState(false)
  const savedTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(boss.statusLine)
    setSavedFlash(false)
    const id = window.setTimeout(() => { inputRef.current?.focus() }, 40)
    return () => { window.clearTimeout(id) }
  }, [open, boss.statusLine])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  useEffect(() => () => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
  }, [])

  if (!open) return null

  const runtime = getPresenceSettingsRuntime()
  const flashSaved = (): void => {
    setSavedFlash(true)
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => {
      setSavedFlash(false)
      savedTimer.current = null
    }, 1600)
  }
  const applyMood = (moodId: string): void => {
    runtime?.setMood(moodId)
    flashSaved()
  }
  const applyTip = (tip: string): void => {
    runtime?.setStatusLine(tip)
    setDraft(tip)
    flashSaved()
  }
  const commitDraft = (flash = true): void => {
    runtime?.setStatusLine(draft)
    if (flash) flashSaved()
  }
  const clearTip = (): void => {
    runtime?.setStatusLine('')
    setDraft('')
    flashSaved()
  }
  const tipDirty = draft.trim() !== (boss.statusLine ?? '').trim()
  const canSave = tipDirty

  const saveAll = (): void => {
    commitDraft(false)
    flashSaved()
  }

  return (
    <div className={css.sheet} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className={css.head}>
        <div className={css.headText}>
          <span id={titleId} className={css.title}>{t('bossStatus.title', { boss: seatTitles.boss })}</span>
          <span className={css.subtitle}>{t('bossStatus.subtitle')}</span>
        </div>
        <button type="button" className={css.close} aria-label={t('bossStatus.close')} onClick={onClose}>
          ×
        </button>
      </div>

      <div className={css.section}>
        <span className={css.label}>{t('bossStatus.mood')}</span>
        <div className={css.moodGrid} role="listbox" aria-label={t('bossStatus.mood')}>
          {BOSS_QUICK_MOOD_IDS.map((id) => {
            const nameKey = `preview.status.emotion.${id}` as PlanKey
            const selected = boss.moodId === id
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className={clsx(css.moodChip, selected && css.moodSelected)}
                onClick={() => { applyMood(id) }}
              >
                <span className={css.moodId} aria-hidden>{id}</span>
                <span className={css.moodName}>{t(nameKey)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className={css.section}>
        <span className={css.label}>{t('bossStatus.tip')}</span>
        <div className={css.tipRow}>
          <input
            ref={inputRef}
            className={css.tipInput}
            value={draft}
            maxLength={PRESENCE_STATUS_LINE_MAX}
            placeholder={t('bossStatus.tipPlaceholder')}
            aria-label={t('bossStatus.tip')}
            onChange={(e) => { setDraft(e.target.value) }}
            onBlur={() => { commitDraft() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              }
            }}
          />
          {boss.statusLine || draft
            ? (
              <button type="button" className={css.clearTip} onClick={clearTip}>
                {t('bossStatus.clearTip')}
              </button>
            )
            : null}
        </div>
        <div className={css.presetRow} role="list" aria-label={t('bossStatus.presets')}>
          {boss.statusPresets.map((tip) => {
            const selected = boss.statusLine === tip
            return (
              <button
                key={tip}
                type="button"
                className={clsx(css.presetChip, selected && css.presetSelected)}
                aria-pressed={selected}
                onClick={() => { applyTip(tip) }}
              >
                {tip}
              </button>
            )
          })}
        </div>
        <p className={css.hint}>{t('bossStatus.presetsHint')}</p>
      </div>

      <div className={css.foot}>
        <span className={clsx(css.liveHint, savedFlash && css.savedFlash)} role="status" aria-live="polite">
          {savedFlash ? t('bossStatus.saved') : t('bossStatus.liveHint')}
        </span>
        <button
          type="button"
          className={css.saveBtn}
          disabled={!canSave}
          onClick={saveAll}
        >
          {savedFlash && !canSave ? t('bossStatus.saved') : t('bossStatus.save')}
        </button>
      </div>
    </div>
  )
}
