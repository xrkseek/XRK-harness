import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { loadPreviewTabs, type PreviewTabLoad } from './preview-load.ts'
import css from './PreviewTabs.module.css'

export type PreviewTabId = 'todos' | 'plan' | 'office'

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

type TodoRow = { content: string; status: string }

function todoStatusLabel(
  status: string,
  t: PreviewTabsProps['t'],
): string {
  if (status === 'pending') return t('preview.todos.status.pending')
  if (status === 'in_progress') return t('preview.todos.status.in_progress')
  if (status === 'completed') return t('preview.todos.status.completed')
  return status
}

/**
 * Session overview for the layout details column: standing todos, plan mode,
 * and Office. Plan rows ride the live `plan` projection; todos ride `todos`.
 * Office still reads `/office` status. File workbench UI stays in the sidebar
 * plugin — this column answers "what is this session's plan state?".
 */
export function PreviewTabs({ sessionId, closeDetails, t, useProjection }: PreviewTabsProps) {
  const [tab, setTab] = useState<PreviewTabId>('todos')
  const [loaded, setLoaded] = useState<PreviewTabLoad>({ plan: null, office: null })
  const [ready, setReady] = useState(false)
  const plan = useProjection('plan') ?? loaded.plan
  // Face `todos` standing plan — keyed through host projections; cast keeps
  // this package free of a hard dependency on the todo stub types package.
  const todos = (useProjection as (key: string) => unknown)('todos') as TodoRow[] | null
  const office = loaded.office

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadPreviewTabs(sessionId).then((next) => {
      if (!alive) return
      setLoaded(next)
      setReady(true)
    })
    return () => { alive = false }
  }, [sessionId, tab])

  const emptyCopy = ready ? t('preview.unavailable') : t('preview.loading')

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.tabs} role="tablist" aria-label={t('preview.tabs')}>
          <button
            type="button"
            role="tab"
            className={css.tab}
            aria-selected={tab === 'todos'}
            onClick={() => { setTab('todos') }}
          >
            {t('preview.todos')}
          </button>
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
      <p className={css.intro}>{t('preview.intro')}</p>
      <div className={css.body} role="tabpanel">
        {tab === 'todos'
          ? todos === null || todos.length === 0
            ? <div className={css.empty}>{t('preview.todos.empty')}</div>
            : (
              <ul className={css.todoList}>
                {todos.map((item, index) => (
                  <li key={`${index}:${item.content}`} className={css.todoItem} data-status={item.status}>
                    <span className={css.todoStatus}>{todoStatusLabel(item.status, t)}</span>
                    <span className={css.todoContent}>{item.content}</span>
                  </li>
                ))}
              </ul>
            )
          : tab === 'plan'
            ? plan === null
              ? <div className={css.empty}>{emptyCopy}</div>
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
              ? <div className={css.empty}>{emptyCopy}</div>
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

/** Composer control that opens the session overview (details) column. */
export function PreviewOpenButton({ openPreview, t }: PreviewOpenProps) {
  return (
    <button
      type="button"
      className={css.open}
      onClick={() => { openPreview() }}
      title={t('preview.openHint')}
      aria-label={t('preview.open')}
    >
      {t('preview.open')}
    </button>
  )
}
