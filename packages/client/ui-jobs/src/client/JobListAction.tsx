import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { JobView } from '@xrkseek/client-runtime/client'
import { IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@xrkseek/client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@xrkseek/client-ui-conversation/client'
import { isLiveJob, orderedJobs } from './job-list-shared.ts'
import { JobRows } from './JobRows.tsx'
import { useJobClock } from './use-job-clock.ts'
import css from './JobListAction.module.css'

/** Business actions supplied by the slot registration. */
export interface JobListInjected {
  killJob(jobId: string): void
  backgroundJob(jobId: string): void
}

/** Full props for the session-header background-job action. */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'> & JobListInjected & PropsLocale<typeof NS>

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS: readonly JobView[] = []

/** Hidden pre-place so the first layout pass measures real menu size (Menu portal pattern). */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Overview (details) strip reserved on `document.documentElement` by AppFrame. */
function readDetailsInsetPx(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--xrk-layout-inset-details')
    .trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

/**
 * Session-header entry point for this session's background jobs. It renders
 * nothing at all until the session has at least one job, so an ordinary
 * conversation never grows a control for a capability it is not using.
 * Expand a row to stream Host `jobs.output` into a TerminalBlock.
 *
 * The open list is portaled to `document.body` (fixed) so the Overview
 * details column cannot paint over it — in-flow absolute menus lose to the
 * later grid sibling even with a high local z-index.
 */
export function JobListAction({ sessionId, useSessions, killJob, backgroundJob, t }: JobListActionProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => orderedJobs(jobs), [jobs])
  const liveRows = useMemo(() => rows.filter(isLiveJob), [rows])
  const settledRows = useMemo(() => rows.filter((job) => !isLiveJob(job)), [rows])
  const liveCount = liveRows.length
  const now = useJobClock(open && liveCount > 0)

  useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef)

  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
  }, [jobs.length, open])

  useEffect(() => {
    if (expandedId !== undefined && !jobs.some((job) => job.id === expandedId)) {
      setExpandedId(undefined)
    }
  }, [jobs, expandedId])

  // Place under the trigger, end-aligned (grows left, away from Overview), and
  // clamp so the card stays clear of the details inset + viewport edges.
  useLayoutEffect(() => {
    if (!open) {
      setFixedPos(null)
      return
    }
    const place = (): void => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (trigger === null) return
      const r = trigger.getBoundingClientRect()
      const MARGIN = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const detailsInset = readDetailsInsetPx()
      const lw = menu !== null && menu.offsetWidth > 0 ? menu.offsetWidth : 420
      const lh = menu !== null && menu.offsetHeight > 0 ? menu.offsetHeight : 0
      let x = r.right - lw
      let y = r.bottom + 5
      const maxRight = vw - Math.max(0, detailsInset) - MARGIN
      x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, maxRight - lw))
      if (lh > 0) {
        y = Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - lh - MARGIN))
      }
      setFixedPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, rows.length, expandedId, liveCount])

  // Escape while focus is in the portaled list (outside the trigger root).
  useEffect(() => {
    if (!open) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (expandedId !== undefined) {
        setExpandedId(undefined)
        return
      }
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, expandedId])

  if (jobs.length === 0) return null

  const countKey = liveCount > 0
    ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
    : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
  const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    if (expandedId !== undefined) {
      setExpandedId(undefined)
      return
    }
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onToggleExpand = (jobId: string): void => {
    setExpandedId((current) => (current === jobId ? undefined : jobId))
  }

  const rowProps = {
    now,
    t: t as TranslateNS<typeof NS>,
    css,
    killJob,
    backgroundJob,
    expandedId,
    onToggleExpand,
  }

  const menu = open
    ? (
      <ul
        ref={menuRef}
        className={css.menu}
        style={fixedPos ?? MEASURE_STYLE}
        aria-label={t('list.aria')}
        data-job-list-portal=""
      >
        {liveRows.length > 0 && settledRows.length > 0
          ? <li className={css.section} role="presentation">{t('section.live')}</li>
          : null}
        {liveRows.length > 0
          ? <JobRows rows={liveRows} {...rowProps} />
          : null}
        {liveRows.length > 0 && settledRows.length > 0
          ? <li className={css.section} role="presentation">{t('section.settled')}</li>
          : null}
        {settledRows.length > 0
          ? <JobRows rows={settledRows} {...rowProps} />
          : null}
      </ul>
    )
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {menu !== null ? createPortal(menu, document.body) : null}
    </div>
  )
}
