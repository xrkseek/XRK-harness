import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

/** Stable no-op subscribe for optional faces — never allocate `() => {}` per render. */
const NOOP_SUBSCRIBE = (_onStoreChange: () => void): (() => void) => () => {}
import type { KeyboardEvent, ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconCloseFill14,
  IconCodeOutline16,
  IconDataOutline16,
  IconGaugeOutline16,
  IconStopFill16,
  IconThinkOutline16,
  StateDot,
  TerminalBlock,
  EMPTY_WORKSPACE_CHANGES_TURNS,
  stableWorkspaceChangesTurns,
} from '@xrkseek/client-ui-primitives'
import { OverviewChangesPanel, type OverviewChangesTurn } from './OverviewChangesPanel.tsx'
import { OverviewCanvasPanel } from './OverviewCanvasPanel.tsx'
import { SubagentGraphBoard } from './SubagentGraphBoard.tsx'
import { PresenceBall } from './PresenceBall.tsx'
import { useOverviewOpen } from './overview-open.ts'
import { PRESENCE_RAIL_HANDOFF_MS } from './presence-handoff.ts'
import {
  getCanvasFocusSnapshot,
  subscribeCanvasFocus,
} from './canvas-focus.ts'
import type { StateDotState } from '@xrkseek/client-ui-primitives'
import {
  loadPreviewTabs,
  type PreviewTabLoad,
  type SessionStatusView,
} from './preview-load.ts'
import { peekJobOutput as defaultPeekJobOutput } from './job-output-peek.ts'
import {
  OVERVIEW_PAINT_TABS,
  readOverviewScroll,
  takeOverviewMountPaint,
  writeOverviewSessionUi,
  type OverviewPaintTab,
} from './overview-paint.ts'
import {
  readOverviewLoadCache,
  writeOverviewLoadCache,
} from './overview-load-cache.ts'
import { overviewStatusPollMs } from './overview-status-poll.ts'
import { EMPTY_PRESENCE_SESSION_CUES } from './presence-session-cues.ts'
import css from './PreviewTabs.module.css'

export { overviewStatusPollMs } from './overview-status-poll.ts'

/**
 * Matches `LAYOUT_INSET_ATTR.details` from ui-layout's public insets contract.
 * Value-importing `@xrkseek/client-ui-layout/client` is forbidden across client
 * plugins (bundle purity); the stamp string is the durable CSS selector.
 */
const DETAILS_INSET_ATTR = 'data-xrk-layout-details'

/** Persist Overview presence rail collapsed chrome across reloads. */
const PRESENCE_COLLAPSED_KEY = 'xrk.overview.presenceCollapsed'

function readPresenceCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(PRESENCE_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writePresenceCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(PRESENCE_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* private mode / quota — chrome preference is best-effort */
  }
}

function delegateSeatCaption(role: string, name: string | undefined): string {
  const n = name?.trim()
  if (!n || n === 'untitled') return role
  return `${role} · ${n}`
}

export type PreviewTabId = 'status' | 'context' | 'todos' | 'changes' | 'canvas'

/** Injected by ui-plan: close the layout details column; open spill paths; Teams actions. */
export interface PreviewTabsInjected {
  closeDetails: () => void
  /**
   * Open a spill locator (absolute path under `{XRK_HOME}/spill`) via Host
   * `host.openPath`. Optional in tests that only assert Status copy.
   */
  openSpillPath?: (path: string) => void | Promise<void>
  /** Open a Teams child session via catalog address (Status task board). */
  openTeamChild?: (input: {
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly mode?: 'continuable' | 'one-shot'
  }) => void | Promise<void>
  /** Interrupt + takeover (pause for human) on a continuable Teams child. */
  pauseTeamChild?: (input: {
    readonly parentSessionId: string
    readonly childSessionId: string
  }) => void | Promise<void>
  /** Resume after takeover via subagent.prompt (clears humanOwned). */
  resumeTeamChild?: (input: {
    readonly parentSessionId: string
    readonly childSessionId: string
  }) => void | Promise<void>
  /**
   * Fold a managed worktree lease into the parent checkout (Face
   * `worktree.merge`, ff-only). Shown on Status task rows with a lease.
   */
  mergeTeamWorktree?: (input: {
    readonly leaseId: string
    readonly pruneAfter?: boolean
  }) => void | Promise<void>
  /**
   * Peek Host `jobs.output` for a Status job row (same bridge as header Jobs).
   * Optional in tests that only assert labels.
   */
  peekJobOutput?: (jobId: string) => Promise<{ readonly text: string; readonly truncated: boolean }>
  /** Interrupt a running background job (two-press confirm in the Status list). */
  killJob?: (jobId: string) => void
  /** Face `changes.fileDiff` for the Status Changes tab. */
  loadFileDiff?: (
    seq: number,
    index: number,
    signal: AbortSignal,
  ) => Promise<import('@xrkseek/xrk-api-remotes/client').WorkspaceFileDiff | null>
  /** Open a changed file path (community better-sidebar + workspaces.openPath). */
  openChangedFile?: (path: string) => void | Promise<void>
  /**
   * Optional `ctx.changesReview` face — turn-tail cards open this tab via
   * soft get (no hard dependency on ui-deliverables).
   */
  changesReview?: {
    getSnapshot: () => {
      readonly sessionId: string
      readonly seq: number
      readonly index: number
      readonly revision: number
    } | null
    subscribe: (listener: () => void) => () => void
  }
  /**
   * Conversation-timeline harvest of embedded `workspace/changes` cards.
   * Used when Face `workspaceChanges` is empty (reconnect truncate / seed lag).
   */
  changeTurnsFallback?: {
    getSnapshot: () => readonly OverviewChangesTurn[]
    subscribe: (listener: () => void) => () => void
  }
  /**
   * Transcript cues for Overview presence (tool errors · last activity).
   * Soft face — Overview still works when the session binding is absent.
   */
  presenceCues?: {
    getSnapshot: () => {
      readonly toolError?: { readonly name?: string }
      readonly activityAt: number
    }
    subscribe: (listener: () => void) => () => void
  }
  /** Face `canvas.list` for the Overview Canvas tab. */
  listCanvases?: (signal: AbortSignal) => Promise<{
    readonly workspaceId: string
    readonly generation: number
    readonly items: readonly {
      readonly id: string
      readonly title: string
      readonly revision: number
      readonly updatedAt: string
    }[]
  }>
  /** Face `canvas.get` for the Overview Canvas player. */
  getCanvas?: (
    id: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly id: string
    readonly title: string
    readonly revision: number
    readonly createdAt: string
    readonly updatedAt: string
    readonly sections: readonly unknown[]
  } | null>
  /**
   * Canvas Build: `/plan off` + optional implement steer.
   * Null = ok; string = English error (not localized).
   */
  buildFromCanvas?: (canvasTitle: string) => Promise<string | null>
}

export type PreviewTabsProps =
  PropsRuntime<'details'>
  & PropsRenderSlots<'details.status.utilities'>
  & InjectFace<PreviewTabsInjected>
  & PropsLocale<'plan'>

/** Map a fleet health string onto the StateDot state set. */
function healthDotState(health: string): StateDotState {
  if (health === 'ok') return 'done'
  if (health === 'warn') return 'warning'
  return 'error'
}

/** Status column order for the Teams task board (open work first). */
function teamTaskStatusRank(status: string): number {
  switch (status) {
    case 'in_progress': return 0
    case 'paused': return 1
    case 'pending': return 2
    case 'completed': return 3
    case 'failed': return 4
    default: return 5
  }
}

/**
 * Collapsible card used for every Status / Context / Rollout section.
 * The body stays mounted (CSS-hidden when closed) so live projections and
 * spill links keep their text reachable; the header button owns expand state.
 */
function SectionCard({
  label,
  title,
  meta,
  children,
  defaultOpen = true,
  signal,
  t,
}: {
  label: string
  title: string
  meta?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** When this number flips, force the section open/closed (expand-all toggle). */
  signal?: { open: boolean; version: number } | undefined
  t: PreviewTabsProps['t']
}) {
  const [open, setOpen] = useState(defaultOpen)
  const lastSignalVersion = useRef<number | null>(null)
  // Depend on primitives — StatusPanel rebuilds `{ open, version }` each paint;
  // object identity would re-enter the effect every time (React #185 risk).
  const signalOpen = signal?.open
  const signalVersion = signal?.version
  useEffect(() => {
    if (signalVersion === undefined || signalOpen === undefined) return
    // Skip the mount-time signal so per-card defaultOpen wins; only
    // expand/collapse-all (version bumps) override local state.
    if (lastSignalVersion.current === null) {
      lastSignalVersion.current = signalVersion
      return
    }
    if (signalVersion === lastSignalVersion.current) return
    lastSignalVersion.current = signalVersion
    setOpen(signalOpen)
  }, [signalOpen, signalVersion])
  const bodyId = `preview-section-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  return (
    <section className={css.section} aria-label={label}>
      <button
        type="button"
        className={css.sectionHeader}
        aria-expanded={open}
        aria-controls={bodyId}
        title={open ? t('preview.collapse') : t('preview.expand')}
        onClick={() => { setOpen((prev) => !prev) }}
      >
        <IconChevronDownOutline14 size={14} className={css.sectionChevron} />
        <span className={css.sectionTitle}>{title}</span>
        {meta ? <span className={css.sectionMeta}>{meta}</span> : null}
      </button>
      <div id={bodyId} className={css.sectionBody} hidden={!open}>
        {children}
      </div>
    </section>
  )
}

function Flag({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return (
    <span className={css.flag} data-on={on ? 'true' : 'false'}>
      {on ? yes : no}
    </span>
  )
}

type TodoRow = { content: string; status: string }

/** Live Face `contextTimeline` wire (subset Status needs for event rows). */
type LiveTimelineEvent =
  | {
    readonly kind: 'inject'
    readonly seq: number
    readonly form?: string
    readonly source?: string
    readonly name?: string
    readonly sub?: string
  }
  | {
    readonly kind: 'compaction'
    readonly seq: number
    readonly count: number
    readonly reason: 'auto' | 'overflow' | 'manual'
    readonly shadowedTokenCount?: number
  }
  | {
    readonly kind: 'prune'
    readonly seq: number
    readonly tool?: string
    readonly prevTokens?: number
    readonly spill?: boolean
    readonly spillPath?: string
  }
  | {
    readonly kind: 'model' | 'mode'
    readonly seq: number
  }

type LiveContextTimeline = {
  readonly current?: {
    readonly system: number
    readonly tools: number
    readonly user: number
    readonly inject: number
    readonly assistant: number
    readonly tool: number
    readonly total: number
  }
  readonly events?: readonly LiveTimelineEvent[]
  readonly requests?: readonly unknown[]
}

const CONTEXT_BROWSER_LIMIT = 48

type SpillEntry = NonNullable<SessionStatusView['compaction']['spillPaths']>[number]

/** Shared spill peek rows for Compaction (Status) and Context browser. */
function SpillEntries({
  entries,
  t,
  openSpillPath,
}: {
  entries: readonly SpillEntry[]
  t: PreviewTabsProps['t']
  openSpillPath?: PreviewTabsInjected['openSpillPath']
}) {
  return (
    <ul className={css.itemList} aria-label={t('preview.status.spillList')}>
      {entries.map((entry) => (
        <li key={entry.path} className={css.itemRow}>
          <div className={css.teamTaskBody}>
            <span className={css.itemTitle} title={entry.path}>{entry.name}</span>
            <span className={css.itemMeta}>
              {entry.tool ? `${entry.tool} · ` : ''}
              {entry.bytes !== undefined
                ? `${entry.bytes} B`
                : t('preview.status.spillMissing')}
            </span>
            {entry.preview
              ? <pre className={css.spillPreview}>{entry.preview}</pre>
              : null}
          </div>
          {openSpillPath
            ? (
              <button
                type="button"
                className={css.spillOpen}
                onClick={() => { void openSpillPath(entry.path) }}
                title={entry.path}
              >
                {t('preview.status.spillOpen')}
              </button>
            )
            : null}
        </li>
      ))}
    </ul>
  )
}

function todoStatusLabel(
  status: string,
  t: PreviewTabsProps['t'],
): string {
  if (status === 'pending') return t('preview.todos.status.pending')
  if (status === 'in_progress') return t('preview.todos.status.in_progress')
  if (status === 'completed') return t('preview.todos.status.completed')
  return status
}

function injectEventLabel(ev: Extract<LiveTimelineEvent, { kind: 'inject' }>): string {
  if (ev.name) return `${ev.source ?? ev.form ?? 'inject'}:${ev.name}`
  if (ev.source) return ev.source
  if (ev.form) return ev.form
  return 'inject'
}

type TimelineRow = {
  title: string
  meta: string
  spillPath?: string
}

function timelineEventMeta(ev: LiveTimelineEvent): TimelineRow | null {
  if (ev.kind === 'inject') {
    return {
      title: `inject · ${injectEventLabel(ev)}`,
      meta: ev.sub ? `skill · #${ev.seq}` : `#${ev.seq}`,
    }
  }
  if (ev.kind === 'compaction') {
    const shadowed = typeof ev.shadowedTokenCount === 'number'
      ? ` · shadowed ${ev.shadowedTokenCount}`
      : ''
    return {
      title: `compact · ${ev.reason}`,
      meta: `${ev.count} nodes${shadowed} · #${ev.seq}`,
    }
  }
  if (ev.kind === 'prune') {
    const bits = [
      ev.tool ? `tool:${ev.tool}` : null,
      typeof ev.prevTokens === 'number' ? `prev ${ev.prevTokens}` : null,
      ev.spill ? 'spill' : null,
    ].filter(Boolean)
    const spillPath = typeof ev.spillPath === 'string' && ev.spillPath.trim()
      ? ev.spillPath.trim()
      : undefined
    return {
      title: ev.spill ? 'prune · spill' : 'prune',
      meta: `${bits.length > 0 ? `${bits.join(' · ')} · ` : ''}#${ev.seq}`,
      ...(spillPath ? { spillPath } : {}),
    }
  }
  return null
}

type StatusJob = SessionStatusView['jobs'][number]

const KILL_ARM_MS = 3_000
const OUTPUT_POLL_MS = 400

/** Expandable Status job row: peeks Host output + optional two-press kill. */
function StatusJobsList({
  jobs,
  t,
  peekJobOutput,
  killJob,
}: {
  jobs: readonly StatusJob[]
  t: PreviewTabsProps['t']
  peekJobOutput?: PreviewTabsInjected['peekJobOutput']
  killJob?: PreviewTabsInjected['killJob']
}) {
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
  const peek = peekJobOutput ?? defaultPeekJobOutput

  useEffect(() => {
    if (expandedId !== undefined && !jobs.some((job) => job.id === expandedId)) {
      setExpandedId(undefined)
    }
  }, [jobs, expandedId])

  if (jobs.length === 0) {
    return <div className={css.empty}>{t('preview.status.jobsEmpty')}</div>
  }

  return (
    <ul className={css.itemList}>
      {jobs.map((job) => {
        const live = job.status === 'running' || job.status === 'stopping'
        const expanded = expandedId === job.id
        const label = job.label ?? job.id
        return (
          <li key={job.id} className={css.jobItem} data-live={live || undefined}>
            <div className={css.jobLine}>
              <button
                type="button"
                className={css.jobTrigger}
                aria-expanded={expanded}
                aria-label={t(
                  expanded ? 'preview.status.jobsCollapseAria' : 'preview.status.jobsExpandAria',
                  { label },
                )}
                onClick={() => {
                  setExpandedId((current) => (current === job.id ? undefined : job.id))
                }}
              >
                <StateDot state={live ? 'ongoing' : 'done'} size={8} />
                <IconChevronDownOutline14
                  size={10}
                  className={expanded ? css.jobChevronOpen : css.jobChevron}
                />
                <span className={css.itemTitle}>{label}</span>
                <span className={css.itemMeta}>{job.status}</span>
              </button>
              {live && killJob !== undefined
                ? (
                  <StatusKillButton
                    jobId={job.id}
                    label={label}
                    status={job.status}
                    killJob={killJob}
                    t={t}
                  />
                )
                : null}
            </div>
            {expanded
              ? (
                <StatusJobOutput
                  jobId={job.id}
                  label={label}
                  live={live}
                  peek={peek}
                  t={t}
                />
              )
              : null}
          </li>
        )
      })}
    </ul>
  )
}

function StatusKillButton({
  jobId,
  label,
  status,
  killJob,
  t,
}: {
  jobId: string
  label: string
  status: string
  killJob: (id: string) => void
  t: PreviewTabsProps['t']
}) {
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (armTimer.current !== undefined) clearTimeout(armTimer.current)
  }, [])

  useEffect(() => {
    if (status === 'running' || status === 'stopping') return
    setArmed(false)
  }, [status])

  const title = armed
    ? t('preview.status.jobsKillConfirm')
    : t('preview.status.jobsKillAria', { label })

  return (
    <button
      type="button"
      className={armed ? `${css.jobKill} ${css.jobKillArmed}` : css.jobKill}
      data-kill-state={armed ? 'armed' : 'idle'}
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        if (!armed) {
          setArmed(true)
          if (armTimer.current !== undefined) clearTimeout(armTimer.current)
          armTimer.current = setTimeout(() => { setArmed(false) }, KILL_ARM_MS)
          return
        }
        if (armTimer.current !== undefined) clearTimeout(armTimer.current)
        setArmed(false)
        killJob(jobId)
      }}
    >
      <IconStopFill16 size={10} />
      {armed ? <span className={css.jobKillLabel}>{t('preview.status.jobsKillConfirm')}</span> : null}
    </button>
  )
}

function StatusJobOutput({
  jobId,
  label,
  live,
  peek,
  t,
}: {
  jobId: string
  label: string
  live: boolean
  peek: NonNullable<PreviewTabsInjected['peekJobOutput']>
  t: PreviewTabsProps['t']
}) {
  const [text, setText] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await peek(jobId)
        if (!alive) return
        setText(next.text)
        setTruncated(next.truncated)
        setError(undefined)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    if (!live) return () => { alive = false }
    const timer = setInterval(() => { void load() }, OUTPUT_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [jobId, live, peek])

  return (
    <div className={css.jobPanel}>
      {truncated ? <div className={css.jobNotice}>{t('preview.status.jobsTruncated')}</div> : null}
      {error !== undefined
        ? <div className={`${css.jobNotice} ${css.jobNoticeError}`}>{t('preview.status.jobsOutputError', { error })}</div>
        : null}
      <TerminalBlock
        command={label}
        output={text}
        running={live}
        maxLines={Number.POSITIVE_INFINITY}
      />
    </div>
  )
}

function StatusPanel({
  status,
  t,
  plan,
  office,
  openSpillPath,
  openTeamChild,
  pauseTeamChild,
  resumeTeamChild,
  mergeTeamWorktree,
  peekJobOutput,
  killJob,
  onTeamActionDone,
}: {
  status: SessionStatusView
  t: PreviewTabsProps['t']
  plan: PreviewTabLoad['plan']
  office: PreviewTabLoad['office']
  openSpillPath?: PreviewTabsInjected['openSpillPath']
  openTeamChild?: PreviewTabsInjected['openTeamChild']
  pauseTeamChild?: PreviewTabsInjected['pauseTeamChild']
  resumeTeamChild?: PreviewTabsInjected['resumeTeamChild']
  mergeTeamWorktree?: PreviewTabsInjected['mergeTeamWorktree']
  peekJobOutput?: PreviewTabsInjected['peekJobOutput']
  killJob?: PreviewTabsInjected['killJob']
  onTeamActionDone?: () => void
}) {
  const runningJobs = status.jobs.filter((j) => j.status === 'running')
  const liveSubs = status.subagents.live.filter((s) => s.activity === 'running')
  const wiredIm = status.channels.im.filter((c) => c.wired !== 'bridge')
  // Status summary reads Face `session.status.timeline` only. Live
  // `contextTimeline` projection stays on the Context tab — merging it here
  // re-entered React #185 when the projection face churned under Status.
  const current = status.timeline
  const requestCount = status.timeline.requestCount
  const eventCount = status.timeline.eventCount
  const injectSources = status.timeline.injectSources
  const lastCompactReason = status.timeline.lastCompactReason
  const lastShadowedTokens = status.timeline.lastShadowedTokens
  const spillCount = status.timeline.spillCount
  const pruneCount = status.timeline.pruneCount
  // Mixed defaults: most cards start collapsed — toggle shows Expand all first.
  const [allOpen, setAllOpen] = useState(false)
  const [collapseVersion, setCollapseVersion] = useState(0)
  const collapseSignal = useMemo(
    () => ({ open: allOpen, version: collapseVersion }),
    [allOpen, collapseVersion],
  )
  const [teamActionError, setTeamActionError] = useState<Record<string, string>>({})
  const runTeamAction = async (taskId: string, action: () => void | Promise<void>): Promise<void> => {
    setTeamActionError((prev) => {
      if (!(taskId in prev)) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
    try {
      await action()
      onTeamActionDone?.()
    } catch (err) {
      const message = err instanceof Error && err.message.trim()
        ? err.message.trim()
        : t('preview.status.teamTasksActionFailed')
      setTeamActionError((prev) => ({ ...prev, [taskId]: message }))
    }
  }
  const badge = status.badge.trim().toLowerCase()
  // Session tool-surface badges (docs/profiles.md): only shallow/harness expose
  // nested agents. Still show the surface when live children or a team graph
  // already exist — otherwise a Frugal/default badge after a desynced spawn
  // (or a missed pin) hid the Overview graph while tools had already run.
  const showSubagentSurface =
    badge === 'harness'
    || badge === 'shallow'
    || badge === 'server'
    || status.subagents.live.length > 0
    || status.subagents.graph.nodes.length > 0
  const turnActive = status.delivery.turnActive
  const queued = status.delivery.queued
  const steering = status.delivery.steering
  const summaryBusy =
    turnActive
    || runningJobs.length > 0
    || liveSubs.length > 0
    || queued > 0
    || steering > 0
    || status.compaction.phase === 'busy'
  const summaryBeat = summaryBusy
    ? (turnActive
      ? t('preview.summary.beat.turn')
      : runningJobs.length > 0
        ? t('preview.summary.beat.jobs')
        : liveSubs.length > 0
          ? t('preview.summary.beat.subs')
          : t('preview.summary.beat.busy'))
    : t('preview.summary.beat.idle')

  // Hide empty / duplicate Status cards — the hero already carries health +
  // zero counts; only surface sections that have something to inspect.
  const hasSubagentGraph =
    status.subagents.graph.nodes.length > 0 || status.subagents.live.length > 0
  const hasTeamTasks = status.teamTasks.length > 0
  const hasJobs = status.jobs.length > 0
  const hasDeliveryActivity =
    turnActive || queued > 0 || steering > 0 || status.delivery.compactBlockedByTurn
  const hasCompactionSignal =
    status.compaction.phase === 'busy'
    || status.compaction.pipeline !== 'none'
    || status.compaction.stages.length > 0
    || status.compaction.pruneCount > 0
    || status.compaction.summaryCount > 0
    || status.compaction.spillCount > 0
    || (status.compaction.spillPaths?.length ?? 0) > 0
  const hasChannels =
    status.channels.process.length > 0
    || wiredIm.length > 0
    || status.channels.alerts.length > 0
  // Hero strip: at most three cells so a wrapped last row stays centered.
  // Prefer live activity (≤2), then always keep context total.
  type SummaryStat = { key: string; hot?: true; value: string; label: string }
  const summaryActivity: SummaryStat[] = []
  if (runningJobs.length > 0) {
    summaryActivity.push({
      key: 'jobs',
      hot: true,
      value: String(runningJobs.length),
      label: t('preview.summary.jobs'),
    })
  }
  if (showSubagentSurface && liveSubs.length > 0) {
    summaryActivity.push({
      key: 'subs',
      hot: true,
      value: String(liveSubs.length),
      label: t('preview.summary.subs'),
    })
  }
  if (turnActive || queued > 0 || steering > 0) {
    summaryActivity.push({
      key: 'queue',
      hot: true,
      value: turnActive ? '1' : String(queued + steering),
      label: turnActive ? t('preview.summary.turn') : t('preview.summary.queue'),
    })
  }
  // Stable keys so value updates do not remount <b> (looked like a jump from 0).
  const summaryStats: SummaryStat[] = [
    ...summaryActivity.slice(0, 2),
    {
      key: 'tok',
      value: current.total.toLocaleString(),
      label: t('preview.summary.tokens'),
    },
  ]

  return (
    <div className={css.statusRoot} data-status-badge={status.badge || undefined}>
      <div
        className={css.summary}
        data-health={status.fleet.health}
        data-busy={summaryBusy || undefined}
        aria-label={t('preview.summary')}
      >
        <div className={css.summaryBody}>
          <div className={css.summaryTop}>
            <div className={css.summaryMain}>
              <StateDot
                state={healthDotState(status.fleet.health)}
                size={8}
              />
              <div className={css.summaryTitles}>
                <span className={css.summaryHealth}>
                  {t(`preview.status.fleetHealth.${status.fleet.health}`)}
                </span>
                {status.fleet.alerts.length > 0
                  ? (
                    <span
                      className={css.summaryAlert}
                      data-severity={status.fleet.alerts[0]?.severity ?? undefined}
                      title={status.fleet.alerts[0]?.message ?? undefined}
                    >
                      {status.fleet.alerts[0]?.message}
                    </span>
                  )
                  : null}
                <span className={css.summaryBeat} data-live={summaryBusy || undefined}>
                  {summaryBeat}
                </span>
                <div className={css.summaryMeta}>
                  {status.badge
                    ? <span className={css.summaryChip}>{status.badge}</span>
                    : null}
                  {status.model.model
                    ? (
                      <span
                        className={css.summaryChip}
                        title={`${status.model.provider}/${status.model.model}`}
                      >
                        {status.model.model}
                      </span>
                    )
                    : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              className={css.summaryToggle}
              onClick={() => {
                setAllOpen((prev) => {
                  const next = !prev
                  setCollapseVersion((n) => n + 1)
                  return next
                })
              }}
            >
              {allOpen ? t('preview.collapseAll') : t('preview.expandAll')}
            </button>
          </div>
          <div className={css.summaryStats} data-count={summaryStats.length}>
            {summaryStats.map((stat) => (
              <span
                key={stat.key}
                className={css.summaryStat}
                {...(stat.hot ? { 'data-hot': '' } : {})}
              >
                <b>{stat.value}</b>
                <span className={css.summaryStatLabel}>{stat.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {showSubagentSurface
        ? (
          <>
      {hasSubagentGraph
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.subagents')}
        title={t('preview.status.subagents')}
        signal={collapseSignal}
        defaultOpen
        meta={(
          <>
            {liveSubs.length}/{status.subagents.live.length} live ·{' '}
            {t('preview.status.subagentQuota')}{' '}
            {status.subagents.quota.active}/{status.subagents.quota.maxActive}
            {' · '}
            depth {status.subagents.quota.depth}/{status.subagents.quota.maxDepth}
            {' · '}
            {status.subagents.graph.nodes.length}n/{status.subagents.graph.edges.length}e
          </>
        )}
      >
        <>
              <h4 className={css.sectionTitle}>{t('preview.status.subagentGraph')}</h4>
              <SubagentGraphBoard
                sessionId={status.sessionId}
                rootLabel={t('preview.status.session')}
                nodes={status.subagents.graph.nodes}
                edges={status.subagents.graph.edges}
                live={status.subagents.live}
                emptyLabel={t('preview.status.subagentsEmpty')}
                runningLabel={t('preview.status.subagentRunning')}
                idleLabel={t('preview.status.subagentIdle')}
                {...(openTeamChild
                  ? {
                    onOpenNode: (nodeId: string) => {
                      if (nodeId === status.sessionId) return
                      const edge = status.subagents.graph.edges.find(
                        (item) => item.kind === 'delegates' && item.to === nodeId,
                      )
                      void runTeamAction(nodeId, () => openTeamChild({
                        parentSessionId: edge?.from
                          ?? status.delegate?.parentSessionId
                          ?? status.sessionId,
                        childSessionId: nodeId,
                        mode: 'continuable',
                      }))
                    },
                  }
                  : {})}
              />
              {status.subagents.live.length > 0
                ? (
                  <>
                    <h4 className={css.sectionTitle}>{t('preview.status.subagentLive')}</h4>
                    <ul className={css.itemList}>
                      {status.subagents.live.map((s) => (
                        <li key={s.id} className={css.itemRow} data-live={s.activity === 'running' || undefined}>
                          <StateDot
                            state={s.activity === 'running' ? 'ongoing' : 'done'}
                            size={8}
                          />
                          <span className={css.itemTitle}>{s.label ?? s.id}</span>
                          <span className={css.itemMeta}>
                            {s.activity === 'running'
                              ? t('preview.status.subagentRunning')
                              : t('preview.status.subagentIdle')}
                            {s.model ? ` · ${s.model}` : ''}
                            {s.liveTool ? ` · tool:${s.liveTool}` : s.liveText ? ` · ${s.liveText}` : ` · ${s.mode}`}
                            {(s.queued ?? 0) > 0 || (s.steering ?? 0) > 0
                              ? ` · ${t('preview.status.subagentQueue')} q=${s.queued ?? 0}/steer=${s.steering ?? 0}`
                              : ''}
                            {s.externalKind
                              ? ` · ${t('preview.status.subagentExternal')}:${s.externalKind}${
                                s.externalResume
                                  ? `/${s.externalResume === 'cold'
                                    ? t('preview.status.subagentExternalCold')
                                    : t('preview.status.subagentExternalLive')}`
                                  : ''
                              }`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )
                : null}
            </>
      </SectionCard>
        )
        : null}

      {hasTeamTasks
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.teamTasks')}
        title={t('preview.status.teamTasks')}
        signal={collapseSignal}
        defaultOpen
        meta={(
          <>
            {status.teamTasks.filter((row) => row.status === 'in_progress' || row.status === 'paused').length}
            /
            {status.teamTasks.length} open
          </>
        )}
      >
            <ul className={css.teamTaskList}>
              {[...status.teamTasks]
                .sort((a, b) => teamTaskStatusRank(a.status) - teamTaskStatusRank(b.status))
                .map((task) => {
                  const canOpen = Boolean(openTeamChild && task.childSessionId)
                  const openChild = () => {
                    if (!openTeamChild || !task.childSessionId) return
                    void runTeamAction(task.id, () => openTeamChild({
                      parentSessionId: status.sessionId,
                      childSessionId: task.childSessionId!,
                      mode: 'continuable',
                    }))
                  }
                  return (
                <li
                  key={task.id}
                  className={css.teamTaskCard}
                  data-live={task.status === 'in_progress' || task.status === 'paused' || undefined}
                  data-status={task.status}
                >
                  <div
                    className={canOpen ? css.teamTaskMain : css.teamTaskBody}
                    {...(canOpen
                      ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        onClick: openChild,
                        onKeyDown: (event: KeyboardEvent) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openChild()
                          }
                        },
                      }
                      : {})}
                  >
                    <div className={css.teamTaskHead}>
                      <span className={css.itemTitle}>{task.title}</span>
                      <span className={css.teamTaskBadge} data-status={task.status}>
                        {task.status}
                      </span>
                    </div>
                    <span className={css.itemMeta}>
                      {task.role ? `${task.role}` : 'worker'}
                      {task.humanOwned ? ` · ${t('preview.status.teamTasksHuman')}` : ''}
                      {task.externalResume
                        ? ` · ${t('preview.status.subagentExternal')}:${
                          task.externalResume === 'cold'
                            ? t('preview.status.subagentExternalCold')
                            : t('preview.status.subagentExternalLive')
                        }`
                        : ''}
                      {task.schemaValid === false
                        ? ` · ${t('preview.status.teamTasksSchemaBad')}`
                        : task.schemaValid === true
                          ? ` · ${t('preview.status.teamTasksSchemaOk')}`
                          : ''}
                    </span>
                    {task.childSessionId
                      ? (
                        <span className={css.itemMeta} title={task.childSessionId}>
                          {task.childSessionId.length > 24
                            ? `${task.childSessionId.slice(0, 12)}…${task.childSessionId.slice(-8)}`
                            : task.childSessionId}
                        </span>
                      )
                      : null}
                    {task.worktreeBranch || task.worktreePath
                      ? (
                        <span
                          className={css.itemMeta}
                          title={[
                            task.worktreeBranch,
                            task.worktreePath,
                            task.worktreeLeaseStatus,
                          ].filter(Boolean).join(' · ')}
                        >
                          {t('preview.status.teamTasksWorktree')}
                          {': '}
                          {task.worktreeBranch ?? ''}
                          {task.worktreeLeaseStatus === 'retained'
                            ? ` · ${t('preview.status.teamTasksWorktreeRetained')}`
                            : task.worktreeLeaseStatus
                              ? ` · ${task.worktreeLeaseStatus}`
                              : ''}
                        </span>
                      )
                      : null}
                    {task.resultPreview
                      ? (
                        <span className={css.teamTaskPreview}>
                          {task.resultPreview}
                        </span>
                      )
                      : null}
                    {teamActionError[task.id]
                      ? (
                        <span className={css.teamActionError} role="alert">
                          {teamActionError[task.id]}
                        </span>
                      )
                      : null}
                  </div>
                  {task.childSessionId || task.worktreeId
                    ? (
                      <div className={css.teamTaskActions}>
                        {pauseTeamChild
                          && task.childSessionId
                          && (task.status === 'in_progress' || task.status === 'pending')
                          ? (
                            <button
                              type="button"
                              className={css.teamAction}
                              onClick={() => {
                                void runTeamAction(task.id, () => pauseTeamChild({
                                  parentSessionId: status.sessionId,
                                  childSessionId: task.childSessionId!,
                                }))
                              }}
                            >
                              {t('preview.status.teamTasksPause')}
                            </button>
                          )
                          : null}
                        {resumeTeamChild
                          && task.childSessionId
                          && (
                            task.status === 'paused'
                            || task.humanOwned
                            || task.externalResume === 'cold'
                          )
                          ? (
                            <button
                              type="button"
                              className={css.teamAction}
                              onClick={() => {
                                void runTeamAction(task.id, () => resumeTeamChild({
                                  parentSessionId: status.sessionId,
                                  childSessionId: task.childSessionId!,
                                }))
                              }}
                            >
                              {task.externalResume === 'cold'
                                ? t('preview.status.teamTasksColdResume')
                                : t('preview.status.teamTasksResume')}
                            </button>
                          )
                          : null}
                        {mergeTeamWorktree
                          && task.worktreeId
                          && task.worktreeLeaseStatus !== 'reclaimed'
                          ? (
                            <button
                              type="button"
                              className={css.teamAction}
                              onClick={() => {
                                void runTeamAction(task.id, () => mergeTeamWorktree({
                                  leaseId: task.worktreeId!,
                                  pruneAfter: true,
                                }))
                              }}
                            >
                              {t('preview.status.teamTasksMerge')}
                            </button>
                          )
                          : null}
                      </div>
                    )
                    : null}
                </li>
                  )
                })}
            </ul>
      </SectionCard>
        )
        : null}
          </>
        )
        : null}

      {hasJobs
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.jobs')}
        title={t('preview.status.jobs')}
        signal={collapseSignal}
        defaultOpen={false}
        meta={`${runningJobs.length}/${status.jobs.length} running`}
      >
        <StatusJobsList
          jobs={status.jobs}
          t={t}
          {...(peekJobOutput ? { peekJobOutput } : {})}
          {...(killJob ? { killJob } : {})}
        />
      </SectionCard>
        )
        : null}

      {hasCompactionSignal
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.compaction')}
        title={t('preview.status.compaction')}
        signal={collapseSignal}
        defaultOpen={false}
        meta={(
          <>
            {status.compaction.phase}
            {status.compaction.strategy ? ` · ${status.compaction.strategy}` : ''}
          </>
        )}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.compactionPipeline')}</span>
          <span>
            {status.compaction.stages.length > 0
              ? status.compaction.stages.join(' → ')
              : status.compaction.pipeline}
            {status.compaction.lastReason
              ? ` · ${status.compaction.lastReason}`
              : ''}
            {status.compaction.lastShadowedTokens !== undefined
              ? ` · ${t('preview.status.timelineShadowed')} ${status.compaction.lastShadowedTokens}`
              : ''}
          </span>
        </div>
        {status.compaction.strategy
          ? (
            <div className={css.row}>
              <span className={css.label}>{t('preview.status.compactionStrategy')}</span>
              <span>{status.compaction.strategy}</span>
            </div>
          )
          : null}
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.compactionPhase')}</span>
          <span data-live={status.compaction.phase === 'busy' || undefined}>
            {status.compaction.phase}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.compactionCounts')}</span>
          <span>
            {t('preview.status.countPrune')} {status.compaction.pruneCount}
            {' · '}
            {t('preview.status.countSummary')} {status.compaction.summaryCount}
            {status.compaction.spillCount > 0
              ? ` · ${t('preview.status.countSpill')} ${status.compaction.spillCount}`
              : ''}
          </span>
        </div>
        {(status.compaction.spillPaths?.length ?? 0) > 0
          ? (
            <SpillEntries
              entries={status.compaction.spillPaths!}
              t={t}
              openSpillPath={openSpillPath}
            />
          )
          : null}
      </SectionCard>
        )
        : null}

      {hasDeliveryActivity
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.delivery')}
        title={t('preview.status.delivery')}
        signal={collapseSignal}
        defaultOpen
        meta={(
          <>
            {status.delivery.turnActive
              ? t('preview.status.metaTurn')
              : t('preview.status.metaIdle')}
            {' · '}
            q{status.delivery.queued}/s{status.delivery.steering}
          </>
        )}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.deliveryTurn')}</span>
          <span data-live={status.delivery.turnActive || undefined}>
            {status.delivery.turnActive
              ? t('preview.status.metaActive')
              : t('preview.status.metaIdle')}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.deliveryQueue')}</span>
          <span>
            {t('preview.status.metaQueued')} {status.delivery.queued}
            {' · '}
            {t('preview.status.metaSteering')} {status.delivery.steering}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.deliveryMutex')}</span>
          <span>
            {status.delivery.compactBlockedByTurn
              ? t('preview.status.deliveryMutexBusy')
              : t('preview.status.deliveryMutexIdle')}
          </span>
        </div>
        {status.delivery.note
          ? <p className={css.note} role="note">{status.delivery.note}</p>
          : null}
      </SectionCard>
        )
        : null}

      <SectionCard
        t={t}
        label={t('preview.status.timeline')}
        title={t('preview.status.timeline')}
        signal={collapseSignal}
        defaultOpen
        meta={t('preview.status.timelineSource')}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineTotal')}</span>
          <span>{current.total.toLocaleString()}</span>
        </div>
        {(() => {
          const window = status.timeline.contextWindow
          if (window === undefined || window <= 0) return null
          const pct = Math.min(100, Math.round((current.total / window) * 1000) / 10)
          return (
            <>
              <div className={css.row}>
                <span className={css.label}>{t('preview.status.timelineWindow')}</span>
                <span>
                  {current.total.toLocaleString()} / {window.toLocaleString()}
                  {' · '}
                  {pct}%
                </span>
              </div>
              <div className={css.windowTrack} aria-hidden>
                <div className={css.windowFill} style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </>
          )
        })()}
        <div className={css.barTrack} aria-hidden>
          {([
            ['system', current.system],
            ['tools', current.tools],
            ['user', current.user],
            ['inject', current.inject],
            ['assistant', current.assistant],
            ['tool', current.tool],
          ] as const).map(([key, value]) => {
            const pct = current.total > 0
              ? Math.max(0, (value / current.total) * 100)
              : 0
            if (pct <= 0) return null
            return (
              <span
                key={key}
                className={css.barSeg}
                data-cat={key}
                style={{ width: `${pct}%` }}
                title={`${key}: ${value}`}
              />
            )
          })}
        </div>
        <div className={css.barLegend} aria-hidden>
          {([
            'system',
            'tools',
            'user',
            'inject',
            'assistant',
            'tool',
          ] as const).map((key) => {
            const value = current[key]
            if (value <= 0) return null
            return (
              <span key={key} className={css.barLegendItem}>
                <span className={css.barLegendSwatch} data-cat={key} />
                {t(`preview.status.timelineLegend.${key}`)} {value.toLocaleString()}
              </span>
            )
          })}
        </div>
        <p className={css.note} role="note">{t('preview.status.timelineWindowHint')}</p>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineRequests')}</span>
          <span>
            {requestCount} · {eventCount} {t('preview.status.timelineEvents')}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineInject')}</span>
          <span>
            {injectSources.length === 0
              ? t('preview.status.timelineInjectEmpty')
              : injectSources.slice(0, 6).join(', ')
                + (injectSources.length > 6 ? ` (+${injectSources.length - 6})` : '')}
          </span>
        </div>
        {lastCompactReason
          ? (
            <>
              <div className={css.row}>
                <span className={css.label}>{t('preview.status.timelineCompact')}</span>
                <span>
                  {lastCompactReason}
                  {lastShadowedTokens !== undefined
                    ? ` · ${t('preview.status.timelineShadowed')} ${lastShadowedTokens.toLocaleString()}`
                    : ''}
                </span>
              </div>
              <p className={css.note} role="note">{t('preview.status.timelineCompactHint')}</p>
            </>
          )
          : null}
        {(pruneCount > 0 || spillCount > 0)
          ? (
            <div className={css.row}>
              <span className={css.label}>{t('preview.status.timelineSpill')}</span>
              <span>{t('preview.status.countPrune')} {pruneCount} · {t('preview.status.countSpill')} {spillCount}</span>
            </div>
          )
          : null}
        <p className={css.note} role="note">{t('preview.status.timelineBrowseHint')}</p>
      </SectionCard>

      {hasChannels
        ? (
      <SectionCard
        t={t}
        label={t('preview.status.channels')}
        title={t('preview.status.channels')}
        signal={collapseSignal}
        defaultOpen={false}
        meta={(
          <>
            {status.channels.process.length} process · {status.channels.im.length} im
            {wiredIm.length > 0 ? ` · ${wiredIm.length} gateway` : ''}
          </>
        )}
      >
            <ul className={css.itemList}>
              {status.channels.process.map((p) => (
                <li key={`${p.pluginId}:${p.channelId}`} className={css.itemRow}>
                  <span className={css.itemTitle}>{p.displayName ?? p.channelId}</span>
                  <span className={css.itemMeta}>{p.pluginId}</span>
                </li>
              ))}
              {wiredIm.map((c) => (
                <li key={c.channelId} className={css.itemRow} data-live="">
                  <span className={css.itemTitle}>{c.displayName}</span>
                  <span className={css.itemMeta}>{c.wired}</span>
                </li>
              ))}
            </ul>
        {status.channels.note.trim()
          ? <p className={css.note} role="note">{status.channels.note.trim()}</p>
          : null}
        {status.channels.alerts.length > 0
          ? (
            <ul className={css.itemList}>
              {status.channels.alerts.slice(0, 6).map((alert) => (
                <li key={alert.id} className={css.itemRow}>
                  <span className={css.itemTitle}>[{alert.severity}]</span>
                  <span className={css.itemMeta}>{alert.message}</span>
                </li>
              ))}
            </ul>
          )
          : null}
      </SectionCard>
        )
        : null}

      <SectionCard
        t={t}
        label={t('preview.status.session')}
        title={t('preview.status.session')}
        signal={collapseSignal}
        defaultOpen={false}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.badge')}</span>
          <span className={css.valueChip}>{status.badge}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.permission')}</span>
          <span
            className={css.valueChip}
            data-tone={
              status.permission === 'auto' || /danger|full-access/i.test(status.permission)
                ? 'warn'
                : undefined
            }
          >
            {status.permission === 'auto'
              ? t('preview.status.permission.auto')
              : status.permission}
          </span>
        </div>
        {plan !== null
          ? (
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
          : (
            <div className={css.row}>
              <span className={css.label}>{t('preview.status.plan')}</span>
              <span>{status.plan}</span>
            </div>
          )}
        {office !== null
          ? (
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
          )
          : null}
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.theme')}</span>
          <span>{status.theme}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.model')}</span>
          <span className={css.valueChip} title={`${status.model.provider}/${status.model.model}`}>
            {status.model.provider}/{status.model.model}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.cwd')}</span>
          <span className={css.mono}>{status.cwd}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.events')}</span>
          <span className={css.valueStrong}>{status.events}</span>
        </div>
      </SectionCard>

      <p className={css.note} role="note">{t('preview.status.sameAsSlash')}</p>
    </div>
  )
}

function ContextBrowserPanel({
  status,
  t,
  useProjection,
  openSpillPath,
}: {
  status: SessionStatusView
  t: PreviewTabsProps['t']
  useProjection: PreviewTabsProps['useProjection']
  openSpillPath?: PreviewTabsInjected['openSpillPath']
}) {
  const liveTimeline = (useProjection as (key: string) => unknown)(
    'contextTimeline',
  ) as LiveContextTimeline | null | undefined
  const current = liveTimeline?.current ?? status.timeline
  const liveEvents = Array.isArray(liveTimeline?.events) ? liveTimeline.events : []
  const interesting = liveEvents
    .map(timelineEventMeta)
    .filter((row): row is TimelineRow => row !== null)
  const recent = interesting.slice(-CONTEXT_BROWSER_LIMIT).reverse()
  const folded = Math.max(0, interesting.length - recent.length)
  return (
    <div className={css.statusRoot}>
      <SectionCard
        t={t}
        label={t('preview.context')}
        title={t('preview.context')}
        meta={t('preview.contextHint')}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineTotal')}</span>
          <span>{current.total}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineRequests')}</span>
          <span>
            {Array.isArray(liveTimeline?.requests)
              ? liveTimeline.requests.length
              : status.timeline.requestCount}
            {' / '}
            {liveTimeline?.events
              ? liveTimeline.events.length
              : status.timeline.eventCount}
            {' '}
            {t('preview.status.timelineEvents')}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>sys/tools/user/inject</span>
          <span>
            {current.system}/{current.tools}/{current.user}/{current.inject}
          </span>
        </div>
        {recent.length === 0
          ? <div className={css.empty}>{t('preview.status.timelineLiveEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {recent.map((row, i) => (
                <li key={`${row.title}-${row.meta}-${i}`} className={css.itemRow}>
                  <span className={css.itemTitle}>{row.title}</span>
                  <span className={css.itemMeta}>{row.meta}</span>
                  {row.spillPath && openSpillPath
                    ? (
                      <button
                        type="button"
                        className={css.spillOpen}
                        onClick={() => { void openSpillPath(row.spillPath!) }}
                        title={row.spillPath}
                      >
                        {t('preview.status.spillOpen')}
                      </button>
                    )
                    : null}
                </li>
              ))}
            </ul>
          )}
        {folded > 0
          ? <p className={css.note}>{t('preview.status.timelineLiveMore')} ({folded})</p>
          : null}
      </SectionCard>

      {(status.compaction.spillPaths?.length ?? 0) > 0
        ? (
          <SectionCard
            t={t}
            label={t('preview.status.spillList')}
            title={t('preview.status.spillList')}
            meta={`${status.compaction.spillPaths!.length} · ${t('preview.status.countSpill')} ${status.compaction.spillCount}`}
          >
            <SpillEntries
              entries={status.compaction.spillPaths!}
              t={t}
              openSpillPath={openSpillPath}
            />
          </SectionCard>
        )
        : null}
    </div>
  )
}

/**
 * Session Status / overview for the layout details column.
 * Default tab is Status (fleet · session · jobs · live contextTimeline ·
 * channels), fed by Face `session.status` — the same snapshot as slash
 * `/status`. Plan / Office flags fold into the session card; Context /
 * Changes / todos remain secondary tabs. Trajectory lives on the chat
 * column, not here. Host-wide billing and session cost cards stay out of
 * this column (doctor / export cost.json). Subagent / Teams sections appear
 * only for harness / shallow / server badges.
 */
export function PreviewTabs({
  sessionId,
  closeDetails,
  openSpillPath,
  openTeamChild,
  pauseTeamChild,
  resumeTeamChild,
  mergeTeamWorktree,
  peekJobOutput,
  killJob,
  loadFileDiff,
  openChangedFile,
  changesReview,
  changeTurnsFallback,
  presenceCues,
  listCanvases,
  getCanvas,
  buildFromCanvas,
  t,
  useProjection,
  useSessions,
  renderSlot = (() => null) as PreviewTabsProps['renderSlot'],
}: PreviewTabsProps) {
  const parentId = useSessions((s) => s.byId[sessionId]?.parentId)
  const sessionOrigin = useSessions((s) => s.byId[sessionId]?.origin)
  const mountPaint = takeOverviewMountPaint(sessionId, parentId)
  const [tab, setTab] = useState<PreviewTabId>(() => mountPaint?.tab ?? 'status')
  // Stale-while-revalidate: paint last Face load for this Session immediately;
  // always re-fetch. Do not put Face reads inside soft-face getSnapshot (#185).
  const [loaded, setLoaded] = useState<PreviewTabLoad>(() => (
    readOverviewLoadCache(sessionId) ?? { plan: null, office: null, status: null }
  ))
  const [ready, setReady] = useState(() => readOverviewLoadCache(sessionId)?.status != null)
  const [statusTick, setStatusTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [boundSessionId, setBoundSessionId] = useState(sessionId)
  const [presenceCollapsed, setPresenceCollapsed] = useState(readPresenceCollapsed)
  // Details column stays mounted at width 0. Keep the presence rail in layout
  // so expand does not insert a tall ball and shove Status. Engine waits for
  // the header PresenceDock to exit (one EmotionBall at a time).
  const overviewOpen = useOverviewOpen()
  const [presenceEngineReady, setPresenceEngineReady] = useState(() => overviewOpen)
  const overviewWasOpen = useRef(overviewOpen)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const scrollRestored = useRef(false)
  const tabRef = useRef(tab)
  tabRef.current = tab
  /** Coalesce soft-poll / catalog bumps onto one in-flight Face load. */
  const statusLoadInFlight = useRef(false)
  const statusLoadQueued = useRef(false)
  const statusLastLatencyMs = useRef(0)
  const fleetBusyRef = useRef(false)

  // Same instance, new Session (details slot may keep the tree): adopt remembered chrome.
  if (boundSessionId !== sessionId) {
    setBoundSessionId(sessionId)
    setTab(mountPaint?.tab ?? 'status')
    const cached = readOverviewLoadCache(sessionId)
    setLoaded(cached ?? { plan: null, office: null, status: null })
    setReady(cached?.status != null)
    setRefreshing(false)
    setStatusTick(0)
    statusLoadInFlight.current = false
    statusLoadQueued.current = false
    statusLastLatencyMs.current = 0
    scrollRestored.current = false
  }

  const selectTab = (next: PreviewTabId): void => {
    if (next === tabRef.current) return
    const el = bodyRef.current
    if (el !== null && scrollRestored.current) {
      writeOverviewSessionUi(sessionId, {
        tab: tabRef.current as OverviewPaintTab,
        scrollTop: el.scrollTop,
        parentId,
      })
    }
    setTab(next)
    writeOverviewSessionUi(sessionId, { tab: next as OverviewPaintTab, parentId })
  }

  const plan = useProjection('plan') ?? loaded.plan
  // Face `todos` standing plan — keyed through host projections; cast keeps
  // this package free of a hard dependency on the todo stub types package.
  const todos = (useProjection as (key: string) => unknown)('todos') as TodoRow[] | null
  const workspaceChanges = (useProjection as (key: string) => unknown)(
    'workspaceChanges',
  ) as OverviewChangesTurn[] | null | undefined
  const office = loaded.office
  const status = loaded.status
  const delegatedOverview = sessionOrigin === 'subagent' || Boolean(status?.companionBall)
  // Cold empty only — keep prior Status on screen while soft-refreshing.
  const paintPending = !ready && status === null
  // Live catalog / jobs / running bits — re-pull Face session.status so Overview
  // state machines (fleet · graph · live · jobs · delivery · teams · compaction)
  // stay in lockstep with Host frames. Fingerprint activity and job status, not
  // just membership — otherwise a child/job finishing never bumps the tick.
  const catalogRev = useSessions((s) => {
    const catalog = s.subagentsByParent[sessionId]
    if (catalog === undefined) return ''
    const rows = catalog.entries
      .filter((entry): entry is Extract<typeof entry, { kind: 'child' }> => entry.kind === 'child')
      .map((entry) => `${entry.id}:${entry.activity ?? ''}`)
    return `${catalog.state}:${catalog.entries.length}:${rows.join(',')}`
  })
  const jobsRev = useSessions((s) => {
    const jobs = s.jobsBySession[sessionId] ?? []
    return jobs.map((job) => `${job.id}:${job.status}`).join(',')
  })
  // Badge pin must re-pull session.status — otherwise Overview keeps frugal after
  // the seat/chip already switched the session to harness.
  const agentPresetRev = useSessions((s) => s.byId[sessionId]?.agentPreset ?? '')
  const parentRunning = useSessions((s) => s.byId[sessionId]?.running ?? false)
  const childRunning = useSessions((s) => {
    const catalog = s.subagentsByParent[sessionId]
    if (catalog?.entries.some(
      (entry) => entry.kind === 'child' && entry.activity === 'running',
    )) return true
    // SessionListState rows use `parentId` (projected from wire `parentSessionId`).
    return Object.values(s.byId).some(
      (row) => row?.origin === 'subagent' && row.parentId === sessionId && row.running,
    )
  })
  // Child Overview's 委派方 seat + team graph follow the home session's mux,
  // not this child's own catalog. Face `delegate.parentSessionId` fills in
  // before the session-list row carries `parentId`.
  const homeMuxId = parentId || status?.delegate?.parentSessionId
  const homeCatalogRev = useSessions((s) => {
    if (homeMuxId === undefined || homeMuxId === '') return ''
    const run = s.byId[homeMuxId]?.running ? '1' : '0'
    const catalog = s.subagentsByParent[homeMuxId]
    if (catalog === undefined) return run
    const rows = catalog.entries
      .filter((entry): entry is Extract<typeof entry, { kind: 'child' }> => entry.kind === 'child')
      .map((entry) => `${entry.id}:${entry.activity ?? ''}`)
    return `${run}:${catalog.state}:${catalog.entries.length}:${rows.join(',')}`
  })
  const homeTurnActive = useSessions((s) => (
    homeMuxId !== undefined && homeMuxId !== ''
      ? (s.byId[homeMuxId]?.running ?? false)
      : false
  ))
  const homeSubsRunning = useSessions((s) => {
    if (homeMuxId === undefined || homeMuxId === '') return 0
    const catalog = s.subagentsByParent[homeMuxId]
    const fromCatalog = catalog?.entries.filter(
      (entry) => entry.kind === 'child' && entry.activity === 'running',
    ).length ?? 0
    const fromRows = Object.values(s.byId).filter(
      (row) => row?.origin === 'subagent' && row.parentId === homeMuxId && row.running,
    ).length
    return Math.max(fromCatalog, fromRows)
  })
  const jobsBusy = useSessions((s) => {
    const jobs = s.jobsBySession[sessionId] ?? []
    return jobs.some((job) => job.status === 'running' || job.status === 'stopping')
  })
  const fleetBusy = parentRunning
    || childRunning
    || homeTurnActive
    || homeSubsRunning > 0
    || jobsBusy
    || (status?.subagents.live.some((row) => row.activity === 'running') ?? false)
    || (status?.jobs.some((job) => (
      job.status === 'running'
      || job.status === 'stopping'
      || job.status === 'active'
    )) ?? false)
    || (status?.delivery.turnActive ?? false)
    || ((status?.delivery.queued ?? 0) > 0)
    || ((status?.delivery.steering ?? 0) > 0)
    || (status?.compaction.phase === 'busy')
    || (status?.parentDelivery?.turnActive ?? false)
    || ((status?.parentDelivery?.runningSubs ?? 0) > 0)
    || (status?.teamTasks.some((task) => (
      task.status === 'in_progress' || task.status === 'paused' || task.status === 'pending'
    )) ?? false)
  fleetBusyRef.current = fleetBusy

  const homeId = status?.delegate?.parentSessionId ?? parentId
  const fromTurnActive = Boolean(
    (status?.parentDelivery?.turnActive ?? false)
    || homeTurnActive
    || (status?.subagents.graph.nodes.some(
      (n) => n.id === homeId && n.activity === 'running',
    ) ?? false),
  )
  const fromQueued = status?.parentDelivery?.queued ?? 0
  const fromSteering = status?.parentDelivery?.steering ?? 0
  const fromSubs = Math.max(
    status?.parentDelivery?.runningSubs ?? 0,
    homeSubsRunning,
    status?.subagents.graph.nodes.filter((n) => (
      n.id !== homeId && n.activity === 'running'
    )).length ?? 0,
  )
  const ownTurnActive = Boolean(
    (status?.delivery.turnActive ?? false)
    || parentRunning
    || (status?.subagents.graph.nodes.some(
      (n) => n.id === sessionId && n.activity === 'running',
    ) ?? false),
  )
  const ownSubs = Math.max(
    status?.subagents.live.filter((s) => s.activity === 'running').length ?? 0,
    childRunning ? 1 : 0,
  )

  const reviewFocus = useSyncExternalStore(
    changesReview?.subscribe ?? NOOP_SUBSCRIBE,
    () => {
      const next = changesReview?.getSnapshot() ?? null
      return next !== null && next.sessionId === sessionId ? next : null
    },
    () => null,
  )

  const presenceCue = useSyncExternalStore(
    presenceCues?.subscribe ?? NOOP_SUBSCRIBE,
    () => presenceCues?.getSnapshot() ?? EMPTY_PRESENCE_SESSION_CUES,
    () => EMPTY_PRESENCE_SESSION_CUES,
  )

  // Slot is already in layout; wait for header dock exit before starting the engine.
  useEffect(() => {
    const wasOpen = overviewWasOpen.current
    overviewWasOpen.current = overviewOpen
    if (!overviewOpen) {
      setPresenceEngineReady(false)
      return
    }
    if (wasOpen) {
      setPresenceEngineReady(true)
      return
    }
    const timer = window.setTimeout(() => {
      setPresenceEngineReady(true)
    }, PRESENCE_RAIL_HANDOFF_MS)
    return () => { window.clearTimeout(timer) }
  }, [overviewOpen])

  const canvasFocus = useSyncExternalStore(
    subscribeCanvasFocus,
    () => {
      const next = getCanvasFocusSnapshot()
      return next !== null && next.sessionId === sessionId ? next : null
    },
    () => null,
  )

  useEffect(() => {
    if (reviewFocus !== null) selectTab('changes')
  }, [reviewFocus?.revision])

  useEffect(() => {
    if (canvasFocus !== null) selectTab('canvas')
  }, [canvasFocus?.revision])

  useEffect(() => {
    setStatusTick((n) => n + 1)
  }, [catalogRev, jobsRev, agentPresetRev, parentRunning, childRunning, jobsBusy, homeCatalogRev])

  // Soft-poll session.status so presence / delivery / fleet flip without a
  // membership bump (presence_set is sticky outside the turn latch). Presence
  // rail is always mounted across tabs, so poll even when Status is not selected.
  // Adaptive delay: idle / slow Host stretches the tick so heavy sessions do
  // not pile Face work on the renderer while history is still settling.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const schedule = (): void => {
      const delay = overviewStatusPollMs(fleetBusyRef.current, statusLastLatencyMs.current)
      timer = window.setTimeout(() => {
        if (cancelled) return
        setStatusTick((n) => n + 1)
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [sessionId])

  // Load / soft-refresh Face plan · office · status (keep prior paint on tick).
  // Coalesce: catalog bumps during an in-flight load queue one follow-up instead
  // of stacking concurrent Face hydrates for the same Session.
  useEffect(() => {
    let alive = true
    const run = (): void => {
      if (!alive) return
      if (statusLoadInFlight.current) {
        statusLoadQueued.current = true
        return
      }
      statusLoadInFlight.current = true
      const hadStatus = readOverviewLoadCache(sessionId)?.status != null
        || loaded.status != null
      if (hadStatus) setRefreshing(true)
      const started = performance.now()
      void loadPreviewTabs(sessionId).then((next) => {
        statusLastLatencyMs.current = performance.now() - started
        statusLoadInFlight.current = false
        if (!alive) {
          statusLoadQueued.current = false
          return
        }
        setLoaded((prev) => {
          const merged: PreviewTabLoad = {
            plan: next.plan ?? prev.plan,
            office: next.office ?? prev.office,
            status: next.status ?? prev.status,
          }
          writeOverviewLoadCache(sessionId, merged)
          return merged
        })
        if (next.status != null || hadStatus) setReady(true)
        setRefreshing(false)
        writeOverviewSessionUi(sessionId, { parentId })
        if (statusLoadQueued.current) {
          statusLoadQueued.current = false
          run()
        }
      }, () => {
        statusLastLatencyMs.current = performance.now() - started
        statusLoadInFlight.current = false
        statusLoadQueued.current = false
        if (alive) setRefreshing(false)
      })
    }
    run()
    return () => {
      alive = false
      setRefreshing(false)
    }
  }, [sessionId, statusTick, parentId])

  // Persist scroll for the active tab before the next Session/tab restores.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    return () => {
      writeOverviewSessionUi(sessionId, {
        tab: tabRef.current as OverviewPaintTab,
        scrollTop: el.scrollTop,
        parentId,
      })
    }
  }, [sessionId, parentId, tab])

  // Restore after Session/tab bind, and again once content is ready (height exists).
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    scrollRestored.current = false
    const y = readOverviewScroll(sessionId, tab as OverviewPaintTab)
    el.scrollTop = y
    // Content may grow after paint — re-apply once the browser lays out.
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (bodyRef.current !== null) bodyRef.current.scrollTop = y
        scrollRestored.current = true
      })
    })
    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
  }, [sessionId, tab, ready])

  // Keep the selected tab chip in view when the rail is horizontally clipped.
  useLayoutEffect(() => {
    const rail = tabsRef.current
    if (rail === null) return
    const selected = rail.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  useEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = (): void => {
      if (!scrollRestored.current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        writeOverviewSessionUi(sessionId, {
          tab: tabRef.current as OverviewPaintTab,
          scrollTop: el.scrollTop,
          parentId,
        })
      }, 80)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('scroll', onScroll)
    }
  }, [sessionId, parentId])

  const onTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const order = OVERVIEW_PAINT_TABS
    const index = order.indexOf(tab as OverviewPaintTab)
    const at = index < 0 ? 0 : index
    let next = at
    if (event.key === 'ArrowRight') next = (at + 1) % order.length
    else if (event.key === 'ArrowLeft') next = (at - 1 + order.length) % order.length
    else if (event.key === 'Home') next = 0
    else next = order.length - 1
    selectTab(order[next]!)
    const rail = tabsRef.current
    const buttons = rail?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next]?.focus()
  }

  const refreshStatus = () => { setStatusTick((n) => n + 1) }

  const emptyCopy = ready ? t('preview.unavailable') : t('preview.loading')
  const projectedTurns = Array.isArray(workspaceChanges)
    ? workspaceChanges
    : EMPTY_WORKSPACE_CHANGES_TURNS
  const fallbackTurns = useSyncExternalStore(
    changeTurnsFallback?.subscribe ?? NOOP_SUBSCRIBE,
    () => changeTurnsFallback?.getSnapshot() ?? EMPTY_WORKSPACE_CHANGES_TURNS,
    () => EMPTY_WORKSPACE_CHANGES_TURNS,
  )
  // Face projection and timeline harvest both pass through one fingerprint cache
  // so Overview Changes never sees a fresh array for unchanged content.
  const changeTurns = stableWorkspaceChangesTurns(
    sessionId,
    projectedTurns.length > 0 ? projectedTurns : fallbackTurns,
  )

  return (
    <aside
      className={css.root}
      aria-label={t('preview.tabs')}
      data-xrk-overview=""
      data-xrk-status=""
      data-pending={paintPending || undefined}
      data-refreshing={(!paintPending && refreshing) || undefined}
    >
      <div className={css.header}>
        <div
          ref={tabsRef}
          className={css.tabs}
          role="tablist"
          aria-label={t('preview.tabs')}
          onKeyDown={onTabListKeyDown}
        >
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'status'}
              tabIndex={tab === 'status' ? 0 : -1}
              onClick={() => { selectTab('status') }}
            >
              <IconGaugeOutline16 size={12} className={css.tabIcon} />
              {t('preview.status')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'changes'}
              tabIndex={tab === 'changes' ? 0 : -1}
              onClick={() => { selectTab('changes') }}
            >
              <IconCodeOutline16 size={12} className={css.tabIcon} />
              {t('preview.changes')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'context'}
              tabIndex={tab === 'context' ? 0 : -1}
              onClick={() => { selectTab('context') }}
            >
              <IconDataOutline16 size={12} className={css.tabIcon} />
              {t('preview.context')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'todos'}
              tabIndex={tab === 'todos' ? 0 : -1}
              onClick={() => { selectTab('todos') }}
            >
              <IconChecklistOutline14 size={12} className={css.tabIcon} />
              {t('preview.todos')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'canvas'}
              tabIndex={tab === 'canvas' ? 0 : -1}
              onClick={() => { selectTab('canvas') }}
            >
              <IconBrowseOutline16 size={12} className={css.tabIcon} />
              {t('preview.canvas')}
            </button>
        </div>
        <button
          type="button"
          className={css.close}
          aria-label={t('preview.close')}
          onClick={() => { closeDetails() }}
        >
          <IconCloseFill14 size={14} />
        </button>
      </div>
      <div className={css.tools} aria-label={t('preview.status.tools')}>
        {renderSlot('details.status.utilities', {})}
      </div>
      <div
        className={css.presenceRail}
        data-overview-presence-rail=""
        data-collapsed={presenceCollapsed ? '' : undefined}
        data-delegate={delegatedOverview ? '' : undefined}
        aria-label={t('preview.status.presence')}
        aria-hidden={!overviewOpen || undefined}
        {...(!overviewOpen ? { inert: '' } : {})}
      >
        <div className={css.presenceRailHead}>
          <span className={css.presenceRailTitle}>{t('preview.status.presence')}</span>
          {!presenceCollapsed
            ? <span className={css.presenceRailHint}>{t('preview.status.presenceClick')}</span>
            : null}
          <button
            type="button"
            className={css.presenceCollapse}
            aria-expanded={!presenceCollapsed}
            aria-label={t(presenceCollapsed
              ? 'preview.status.presenceExpand'
              : 'preview.status.presenceCollapse')}
            onClick={() => {
              setPresenceCollapsed((prev) => {
                const next = !prev
                writePresenceCollapsed(next)
                return next
              })
            }}
          >
            <IconChevronDownOutline14 size={14} className={css.presenceCollapseIcon} />
          </button>
        </div>
        {delegatedOverview
          ? (
            <div
              className={css.delegatePair}
              data-collapsed={presenceCollapsed ? '' : undefined}
              data-pending={!status?.companionBall ? '' : undefined}
              role="group"
              aria-label={`${delegateSeatCaption(t('preview.status.presenceHome'), status?.delegate?.parentLabel)} ${t('preview.status.presenceDelegate')} ${delegateSeatCaption(t('preview.status.presenceMember'), status?.delegate?.childLabel)}`}
            >
              <PresenceBall
                sessionId={status?.delegate?.parentSessionId ?? `${sessionId}:from`}
                {...(status?.parentCompanionBall ? { memberLook: status.parentCompanionBall } : {})}
                {...(status?.parentPresence ? { presence: status.parentPresence } : {})}
                pairSeat
                seat="from"
                roleLabel={delegateSeatCaption(
                  t('preview.status.presenceHome'),
                  status?.delegate?.parentLabel,
                )}
                turnActive={fromTurnActive}
                runningJobs={0}
                runningSubs={fromSubs}
                fleetHealth="ok"
                queued={fromQueued}
                steering={fromSteering}
                activityAt={status?.parentPresence?.updatedAt ?? 0}
                compact={presenceCollapsed}
                engineActive={Boolean(overviewOpen && presenceEngineReady && status)}
                t={t as (key: string, params?: Record<string, string>) => string}
                loadingLabel={t('preview.status.presenceLoading')}
                errorLabel={t('preview.status.presenceError')}
                clickHint={t('preview.status.presenceClick')}
              />
              <div className={css.delegateArrow} aria-hidden>
                <svg viewBox="0 0 48 28">
                  <path d="M2 16C12 16 16 6 24 6s12 10 22 10" />
                  <polygon points="40,11 47,16 40,21" />
                </svg>
                {!presenceCollapsed
                  ? <span className={css.delegateCaption}>{t('preview.status.presenceDelegate')}</span>
                  : null}
              </div>
              <PresenceBall
                sessionId={sessionId}
                {...(status?.presence ? { presence: status.presence } : {})}
                {...(status?.companionBall ? { memberLook: status.companionBall } : {})}
                pairSeat
                seat="to"
                roleLabel={delegateSeatCaption(
                  t('preview.status.presenceMember'),
                  status?.delegate?.childLabel,
                )}
                turnActive={ownTurnActive}
                runningJobs={status?.jobs.filter((j) => j.status === 'running').length ?? 0}
                runningSubs={ownSubs}
                fleetHealth={status?.fleet.health ?? 'ok'}
                queued={status?.delivery.queued ?? 0}
                steering={status?.delivery.steering ?? 0}
                compactionBusy={status?.compaction.phase === 'busy'}
                {...(presenceCue.toolError ? { toolError: presenceCue.toolError } : {})}
                activityAt={Math.max(
                  presenceCue.activityAt,
                  status?.presence?.updatedAt ?? 0,
                )}
                compact={presenceCollapsed}
                engineActive={Boolean(overviewOpen && presenceEngineReady && status)}
                t={t as (key: string, params?: Record<string, string>) => string}
                loadingLabel={t('preview.status.presenceLoading')}
                errorLabel={t('preview.status.presenceError')}
                clickHint={t('preview.status.presenceClick')}
              />
            </div>
          )
          : (
            <PresenceBall
              sessionId={sessionId}
              {...(status?.presence ? { presence: status.presence } : {})}
              turnActive={ownTurnActive}
              runningJobs={status?.jobs.filter((j) => j.status === 'running').length ?? 0}
              runningSubs={ownSubs}
              fleetHealth={status?.fleet.health ?? 'ok'}
              queued={status?.delivery.queued ?? 0}
              steering={status?.delivery.steering ?? 0}
              compactionBusy={status?.compaction.phase === 'busy'}
              {...(presenceCue.toolError ? { toolError: presenceCue.toolError } : {})}
              activityAt={Math.max(
                presenceCue.activityAt,
                status?.presence?.updatedAt ?? 0,
              )}
              compact={presenceCollapsed}
              engineActive={overviewOpen && presenceEngineReady}
              t={t as (key: string, params?: Record<string, string>) => string}
              loadingLabel={t('preview.status.presenceLoading')}
              errorLabel={t('preview.status.presenceError')}
              clickHint={t('preview.status.presenceClick')}
            />
          )}
      </div>
      <div
        ref={bodyRef}
        className={css.body}
        role="tabpanel"
        data-pending={paintPending || undefined}
      >
        <div key={`${sessionId}:${tab}`} className={css.pane}>
        {tab === 'status'
          ? status === null
            ? <div className={css.empty}>{emptyCopy}</div>
            : (
              <StatusPanel
                status={status}
                t={t}
                plan={plan}
                office={office}
                {...(openSpillPath ? { openSpillPath } : {})}
                {...(openTeamChild ? { openTeamChild } : {})}
                {...(pauseTeamChild ? { pauseTeamChild } : {})}
                {...(resumeTeamChild ? { resumeTeamChild } : {})}
                {...(mergeTeamWorktree ? { mergeTeamWorktree } : {})}
                {...(peekJobOutput ? { peekJobOutput } : {})}
                {...(killJob ? { killJob } : {})}
                onTeamActionDone={refreshStatus}
              />
            )
          : tab === 'changes'
            ? loadFileDiff === undefined || openChangedFile === undefined
              ? <div className={css.empty}>{t('preview.changes.capability')}</div>
              : (
                <OverviewChangesPanel
                  sessionId={sessionId}
                  turns={changeTurns}
                  {...(changesReview ? { focusFace: changesReview } : {})}
                  loadFileDiff={loadFileDiff}
                  openFile={openChangedFile}
                  t={t}
                />
              )
          : tab === 'context'
            ? status === null
              ? <div className={css.empty}>{emptyCopy}</div>
              : (
                <ContextBrowserPanel
                  status={status}
                  t={t}
                  useProjection={useProjection}
                  {...(openSpillPath ? { openSpillPath } : {})}
                />
              )
            : tab === 'canvas'
              ? listCanvases === undefined || getCanvas === undefined
                ? <div className={css.empty}>{t('preview.canvas.unavailable')}</div>
                : (
                  <OverviewCanvasPanel
                    sessionId={sessionId}
                    listCanvases={listCanvases}
                    getCanvas={getCanvas}
                    focusFace={{
                      getSnapshot: getCanvasFocusSnapshot,
                      subscribe: subscribeCanvasFocus,
                    }}
                    {...(plan != null && (plan.pending ? !plan.active : plan.active)
                      ? { planActive: true as const }
                      : {})}
                    {...(buildFromCanvas ? { onBuild: buildFromCanvas } : {})}
                    t={t}
                  />
                )
            : todos === null || todos.length === 0
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
                )}
        </div>
      </div>
    </aside>
  )
}

/** Injected by ui-plan: open / close the layout details column. */
export interface PreviewOpenInjected {
  openPreview: () => void
  closePreview: () => void
}

export type PreviewOpenProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<PreviewOpenInjected>
  & PropsLocale<'plan'>

/**
 * Session-header toggle for the Status (details) column.
 * Same cluster as Files / Jobs — not under the composer. Reads the layout
 * insets stamp (`data-xrk-layout-details`) so a second click closes.
 */
export function PreviewOpenButton({ openPreview, closePreview, t }: PreviewOpenProps) {
  const [open, setOpen] = useState(() => document.documentElement.hasAttribute(DETAILS_INSET_ATTR))
  useEffect(() => {
    const sync = (): void => {
      setOpen(document.documentElement.hasAttribute(DETAILS_INSET_ATTR))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [DETAILS_INSET_ATTR],
    })
    return () => { observer.disconnect() }
  }, [])
  return (
    <button
      type="button"
      className={css.trigger}
      onClick={() => { if (open) closePreview(); else openPreview() }}
      title={t('preview.openHint')}
      aria-label={open ? t('preview.close') : t('preview.open')}
      aria-pressed={open}
      data-xrk-status-toggle=""
    >
      <IconGaugeOutline16 size={16} />
      <span className={css.triggerLabel}>{t('preview.open')}</span>
    </button>
  )
}
