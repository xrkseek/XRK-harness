import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  loadPreviewTabs,
  type OfficePreviewView,
  type PlanPreviewView,
} from './preview-load.ts'
import css from './PreviewTabs.module.css'

export type PreviewTabId = 'plan' | 'office'

/** Injected by ui-plan: close the layout details column. */
export interface PreviewTabsInjected {
  closeDetails: () => void
}

export type PreviewTabsProps =
  PropsRuntime<'details'>
  & InjectFace<PreviewTabsInjected>
  & PropsLocale<'plan'>

function Flag({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return <span>{on ? yes : no}</span>
}

/**
 * Product details tabs for plan and Office. Reads the existing preview RPC
 * and `/office` status; does not invent payload fields.
 */
export function PreviewTabs({ sessionId, closeDetails, t }: PreviewTabsProps) {
  const [tab, setTab] = useState<PreviewTabId>('plan')
  const [plan, setPlan] = useState<PlanPreviewView | null>(null)
  const [office, setOffice] = useState<OfficePreviewView | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadPreviewTabs(sessionId).then((loaded) => {
      if (!alive) return
      setPlan(loaded.plan)
      setOffice(loaded.office)
      setReady(true)
    })
    return () => { alive = false }
  }, [sessionId])

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.tabs} role="tablist" aria-label={t('preview.tabs')}>
          <button
            type="button"
            role="tab"
            className={css.tab}
            aria-selected={tab === 'plan'}
            onClick={() => { setTab('plan') }}
          >
            {t('preview.plan')}
          </button>
          <button
            type="button"
            role="tab"
            className={css.tab}
            aria-selected={tab === 'office'}
            onClick={() => { setTab('office') }}
          >
            {t('preview.office')}
          </button>
        </div>
        <button type="button" className={css.close} aria-label={t('preview.close')} onClick={() => { closeDetails() }}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body} role="tabpanel">
        {!ready
          ? <div className={css.empty}>{t('preview.loading')}</div>
          : tab === 'plan'
            ? plan === null
              ? <div className={css.empty}>{t('preview.unavailable')}</div>
              : (
                <>
                  <div className={css.row}>
                    <span className={css.label}>{t('preview.plan.active')}</span>
                    <Flag on={plan.active} yes={t('preview.yes')} no={t('preview.no')} />
                  </div>
                  <div className={css.row}>
                    <span className={css.label}>{t('preview.plan.pending')}</span>
                    <Flag on={plan.pending} yes={t('preview.yes')} no={t('preview.no')} />
                  </div>
                </>
              )
            : office === null
              ? <div className={css.empty}>{t('preview.unavailable')}</div>
              : (
                <>
                  <div className={css.row}>
                    <span className={css.label}>{t('preview.office.configured')}</span>
                    <Flag on={office.configured} yes={t('preview.yes')} no={t('preview.no')} />
                  </div>
                  <div className={css.row}>
                    <span className={css.label}>{t('preview.office.connected')}</span>
                    <Flag on={office.connected} yes={t('preview.yes')} no={t('preview.no')} />
                  </div>
                </>
              )}
      </div>
    </div>
  )
}

/** Injected by ui-plan: open the layout details column. */
export interface PreviewOpenInjected {
  openPreview: () => void
}

export type PreviewOpenProps = InjectFace<PreviewOpenInjected> & PropsLocale<'plan'>

/** Composer control that opens the plan / Office preview column. */
export function PreviewOpenButton({ openPreview, t }: PreviewOpenProps) {
  return (
    <button type="button" className={css.open} onClick={() => { openPreview() }}>
      {t('preview.open')}
    </button>
  )
}
