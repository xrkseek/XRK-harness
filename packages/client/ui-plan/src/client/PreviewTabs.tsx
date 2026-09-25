import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutline14, IconCloseFill14, StateDot } from '@xrkseek/client-ui-primitives'
import type { StateDotState } from '@xrkseek/client-ui-primitives'
import {
  loadPreviewTabs,
  type PreviewTabLoad,
  type SessionStatusView,
} from './preview-load.ts'
import css from './PreviewTabs.module.css'

/**
 * Matches `LAYOUT_INSET_ATTR.details` from ui-layout's public insets contract.
 * Value-importing `@xrkseek/client-ui-layout/client` is forbidden across client
 * plugins (bundle purity); the stamp string is the durable CSS selector.
 */
const DETAILS_INSET_ATTR = 'data-xrk-layout-details'

export type PreviewTabId = 'status' | 'context' | 'rollout' | 'todos' | 'plan' | 'office'

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
}

export type PreviewTabsProps =
  PropsRuntime<'details'>
  & InjectFace<PreviewTabsInjected>
  & PropsLocale<'plan'>

/** Map a fleet health string onto the StateDot state set. */
function healthDotState(health: string): StateDotState {
  if (health === 'ok') return 'done'
  if (health === 'warn') return 'warning'
  return 'error'
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
  const lastSignal = useRef({ version: -1 })
  useEffect(() => {
    if (!signal || signal.version === lastSignal.current.version) return
    lastSignal.current.version = signal.version
    setOpen(signal.open)
  }, [signal])
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
  return <span>{on ? yes : no}</span>
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

const TIMELINE_EVENT_LIMIT = 12
const CONTEXT_BROWSER_LIMIT = 48

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

function StatusPanel({
  status,
  t,
  useProjection,
  openSpillPath,
  openTeamChild,
  pauseTeamChild,
  resumeTeamChild,
  onTeamActionDone,
}: {
  status: SessionStatusView
  t: PreviewTabsProps['t']
  useProjection: PreviewTabsProps['useProjection']
  openSpillPath?: PreviewTabsInjected['openSpillPath']
  openTeamChild?: PreviewTabsInjected['openTeamChild']
  pauseTeamChild?: PreviewTabsInjected['pauseTeamChild']
  resumeTeamChild?: PreviewTabsInjected['resumeTeamChild']
  onTeamActionDone?: () => void
}) {
  const runningJobs = status.jobs.filter((j) => j.status === 'running')
  const liveSubs = status.subagents.live.filter((s) => s.activity === 'running')
  const wiredIm = status.channels.im.filter((c) => c.wired !== 'bridge')
  const liveTimeline = (useProjection as (key: string) => unknown)(
    'contextTimeline',
  ) as LiveContextTimeline | null | undefined
  const current = liveTimeline?.current ?? status.timeline
  const liveEvents = Array.isArray(liveTimeline?.events) ? liveTimeline.events : []
  const requestCount = Array.isArray(liveTimeline?.requests)
    ? liveTimeline.requests.length
    : status.timeline.requestCount
  const eventCount = liveTimeline?.events
    ? liveTimeline.events.length
    : status.timeline.eventCount
  const injectSources = status.timeline.injectSources.length > 0
    ? status.timeline.injectSources
    : (() => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const ev of liveEvents) {
        if (ev.kind !== 'inject') continue
        const label = injectEventLabel(ev)
        if (seen.has(label)) continue
        seen.add(label)
        out.push(label)
      }
      return out
    })()
  let lastCompactReason = status.timeline.lastCompactReason
  let lastShadowedTokens = status.timeline.lastShadowedTokens
  let spillCount = status.timeline.spillCount
  let pruneCount = status.timeline.pruneCount
  if (liveEvents.length > 0) {
    spillCount = 0
    pruneCount = 0
    lastCompactReason = undefined
    lastShadowedTokens = undefined
    for (const ev of liveEvents) {
      if (ev.kind === 'compaction') {
        lastCompactReason = ev.reason
        if (typeof ev.shadowedTokenCount === 'number') {
          lastShadowedTokens = ev.shadowedTokenCount
        }
      } else if (ev.kind === 'prune') {
        pruneCount += 1
        if (ev.spill) spillCount += 1
      }
    }
  }
  const interesting = liveEvents
    .map(timelineEventMeta)
    .filter((row): row is TimelineRow => row !== null)
  const recent = interesting.slice(-TIMELINE_EVENT_LIMIT).reverse()
  const folded = Math.max(0, interesting.length - recent.length)
  const [allOpen, setAllOpen] = useState(true)
  const [collapseVersion, setCollapseVersion] = useState(0)
  const collapseSignal = { open: allOpen, version: collapseVersion }
  const costUsd = status.cost.cost.toFixed(4)
  return (
    <div className={css.statusRoot}>
      <div className={css.summary} aria-label={t('preview.summary')}>
        <div className={css.summaryMain}>
          <StateDot
            state={healthDotState(status.fleet.health)}
            size={12}
          />
          <span className={css.summaryHealth}>
            {t(`preview.status.fleetHealth.${status.fleet.health}`)}
          </span>
        </div>
        <div className={css.summaryStats}>
          <span className={css.summaryStat}>
            <b>{runningJobs.length}</b>
            {t('preview.summary.jobs')}
          </span>
          <span className={css.summaryStat}>
            <b>{liveSubs.length}</b>
            {t('preview.summary.subs')}
          </span>
          <span className={css.summaryStat}>
            <b>{current.total}</b>
            {t('preview.summary.tokens')}
          </span>
          <span className={css.summaryStat}>
            <b>${costUsd}</b>
            {t('preview.summary.cost')}
          </span>
        </div>
        <div className={css.summaryActions}>
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
      </div>

      <SectionCard
        t={t}
        label={t('preview.status.fleet')}
        title={t('preview.status.fleet')}
        signal={collapseSignal}
        meta={t(`preview.status.fleetHealth.${status.fleet.health}`)}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.fleetJobs')}</span>
          <span>{status.fleet.runningJobs}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.fleetSubs')}</span>
          <span>
            {status.fleet.runningSubagents} · {t('preview.slot')} {status.fleet.slotsFree}
            {status.fleet.queuedInbox > 0
              ? ` · ${t('preview.inbox')} ${status.fleet.queuedInbox}`
              : ''}
          </span>
        </div>
        {status.fleet.alerts.length === 0
          ? <div className={css.empty}>{t('preview.status.fleetEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {status.fleet.alerts.slice(0, 8).map((alert) => (
                <li key={alert.id} className={css.itemRow}>
                  <span className={css.itemTitle}>[{alert.severity}]</span>
                  <span className={css.itemMeta}>{alert.message}</span>
                </li>
              ))}
            </ul>
          )}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.session')}
        title={t('preview.status.session')}
        signal={collapseSignal}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.badge')}</span>
          <span>{status.badge}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.permission')}</span>
          <span>{status.permission}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.plan')}</span>
          <span>{status.plan}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.theme')}</span>
          <span>{status.theme}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.model')}</span>
          <span>{status.model.provider}/{status.model.model}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.cwd')}</span>
          <span className={css.mono}>{status.cwd}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.events')}</span>
          <span>{status.events}</span>
        </div>
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.subagents')}
        title={t('preview.status.subagents')}
        signal={collapseSignal}
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
        {status.subagents.graph.nodes.length === 0 && status.subagents.live.length === 0
          ? <div className={css.empty}>{t('preview.status.subagentsEmpty')}</div>
          : (
            <>
              {status.subagents.graph.edges.length > 0
                ? (
                  <ul className={css.graphList}>
                    {status.subagents.graph.edges.map((e) => {
                      const from = status.subagents.graph.nodes.find((n) => n.id === e.from)
                      const to = status.subagents.graph.nodes.find((n) => n.id === e.to)
                      return (
                        <li key={`${e.kind}:${e.from}:${e.to}`} className={css.graphEdge}>
                          <span>{from?.label ?? e.from}</span>
                          <span className={css.graphKind}>{e.kind}</span>
                          <span>{to?.label ?? e.to}</span>
                          {e.label ? <span className={css.graphLabel}>{e.label}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                )
                : null}
              {status.subagents.live.length > 0
                ? (
                  <ul className={css.itemList}>
                    {status.subagents.live.map((s) => (
                      <li key={s.id} className={css.itemRow} data-live={s.activity === 'running' || undefined}>
                        <span className={css.itemTitle}>{s.label ?? s.id}</span>
                        <span className={css.itemMeta}>
                          {s.activity}
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
                )
                : null}
            </>
          )}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.teamTasks')}
        title={t('preview.status.teamTasks')}
        signal={collapseSignal}
        meta={(
          <>
            {status.teamTasks.filter((row) => row.status === 'in_progress' || row.status === 'paused').length}
            /
            {status.teamTasks.length} open
          </>
        )}
      >
        {status.teamTasks.length === 0
          ? <div className={css.empty}>{t('preview.status.teamTasksEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {status.teamTasks.map((task) => (
                <li
                  key={task.id}
                  className={css.itemRow}
                  data-live={task.status === 'in_progress' || task.status === 'paused' || undefined}
                >
                  <div className={css.teamTaskBody}>
                    <span className={css.itemTitle}>{task.title}</span>
                    <span className={css.itemMeta}>
                      {task.status}
                      {task.role ? ` · ${task.role}` : ''}
                      {task.humanOwned ? ` · ${t('preview.status.teamTasksHuman')}` : ''}
                      {task.childSessionId ? ` · ${task.childSessionId}` : ''}
                      {task.schemaValid === false
                        ? ` · ${t('preview.status.teamTasksSchemaBad')}`
                        : task.schemaValid === true
                          ? ` · ${t('preview.status.teamTasksSchemaOk')}`
                          : ''}
                    </span>
                    {task.worktreeBranch || task.worktreePath
                      ? (
                        <span className={css.itemMeta}>
                          {t('preview.status.teamTasksWorktree')}
                          {': '}
                          {task.worktreeBranch ?? ''}
                          {task.worktreePath
                            ? `${task.worktreeBranch ? ' · ' : ''}${task.worktreePath}`
                            : ''}
                          {task.worktreeLeaseStatus
                            ? ` · ${task.worktreeLeaseStatus === 'retained'
                              ? t('preview.status.teamTasksWorktreeRetained')
                              : task.worktreeLeaseStatus}`
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
                  </div>
                  {task.childSessionId
                    ? (
                      <div className={css.teamTaskActions}>
                        {openTeamChild
                          ? (
                            <button
                              type="button"
                              className={css.spillOpen}
                              onClick={() => {
                                void Promise.resolve(openTeamChild({
                                  parentSessionId: status.sessionId,
                                  childSessionId: task.childSessionId!,
                                  mode: 'continuable',
                                })).then(() => onTeamActionDone?.())
                              }}
                            >
                              {t('preview.status.teamTasksOpen')}
                            </button>
                          )
                          : null}
                        {pauseTeamChild
                          && (task.status === 'in_progress' || task.status === 'pending')
                          ? (
                            <button
                              type="button"
                              className={css.spillOpen}
                              onClick={() => {
                                void Promise.resolve(pauseTeamChild({
                                  parentSessionId: status.sessionId,
                                  childSessionId: task.childSessionId!,
                                })).then(() => onTeamActionDone?.())
                              }}
                            >
                              {t('preview.status.teamTasksPause')}
                            </button>
                          )
                          : null}
                        {resumeTeamChild
                          && (task.status === 'paused' || task.humanOwned)
                          ? (
                            <button
                              type="button"
                              className={css.spillOpen}
                              onClick={() => {
                                void Promise.resolve(resumeTeamChild({
                                  parentSessionId: status.sessionId,
                                  childSessionId: task.childSessionId!,
                                })).then(() => onTeamActionDone?.())
                              }}
                            >
                              {t('preview.status.teamTasksResume')}
                            </button>
                          )
                          : null}
                      </div>
                    )
                    : null}
                </li>
              ))}
            </ul>
          )}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.jobs')}
        title={t('preview.status.jobs')}
        signal={collapseSignal}
        meta={`${runningJobs.length}/${status.jobs.length} running`}
      >
        {status.jobs.length === 0
          ? <div className={css.empty}>{t('preview.status.jobsEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {status.jobs.map((j) => (
                <li key={j.id} className={css.itemRow} data-live={j.status === 'running' || undefined}>
                  <span className={css.itemTitle}>{j.label ?? j.id}</span>
                  <span className={css.itemMeta}>{j.status}</span>
                </li>
              ))}
            </ul>
          )}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.compaction')}
        title={t('preview.status.compaction')}
        signal={collapseSignal}
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
          <span className={css.label}>{t('preview.status.compactionGuardian')}</span>
          <span>
            {status.compaction.guardian === false
              ? t('preview.status.flagOff')
              : t('preview.status.flagOn')}
          </span>
        </div>
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
            <ul className={css.itemList} aria-label={t('preview.status.spillList')}>
              {status.compaction.spillPaths!.map((path) => (
                <li key={path} className={css.itemRow}>
                  <span className={css.itemMeta} title={path}>{path}</span>
                  {openSpillPath
                    ? (
                      <button
                        type="button"
                        className={css.spillOpen}
                        onClick={() => { void openSpillPath(path) }}
                        title={path}
                      >
                        {t('preview.status.spillOpen')}
                      </button>
                    )
                    : null}
                </li>
              ))}
            </ul>
          )
          : null}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.delivery')}
        title={t('preview.status.delivery')}
        signal={collapseSignal}
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

      <SectionCard
        t={t}
        label={t('preview.status.timeline')}
        title={t('preview.status.timeline')}
        signal={collapseSignal}
        meta={t('preview.status.timelineSource')}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.timelineTotal')}</span>
          <span>{current.total}</span>
        </div>
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
            <div className={css.row}>
              <span className={css.label}>{t('preview.status.timelineCompact')}</span>
              <span>
                {lastCompactReason}
                {lastShadowedTokens !== undefined
                  ? ` · ${t('preview.status.timelineShadowed')} ${lastShadowedTokens}`
                  : ''}
              </span>
            </div>
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
        <h4 className={css.sectionTitle}>{t('preview.status.timelineLive')}</h4>
        {recent.length === 0
          ? <div className={css.empty}>{t('preview.status.timelineLiveEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {recent.map((row, index) => (
                <li
                  key={`${index}:${row.title}:${row.meta}`}
                  className={css.itemRow}
                  {...(row.spillPath ? { 'data-spill-path': row.spillPath } : {})}
                >
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
          ? (
            <p className={css.note} role="note">
              {t('preview.status.timelineLiveMore')} ({folded})
            </p>
          )
          : null}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.cost')}
        title={t('preview.status.cost')}
        signal={collapseSignal}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.costUsd')}</span>
          <span>${status.cost.cost.toFixed(4)}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.costTokens')}</span>
          <span>
            in {status.cost.input} · out {status.cost.output}
            {status.cost.cacheRead ? ` · cacheR ${status.cost.cacheRead}` : ''}
            {status.cost.reasoning ? ` · reason ${status.cost.reasoning}` : ''}
          </span>
        </div>
        {(() => {
          const rows = Object.entries(status.cost.byProviderModel)
            .map(([key, b]) => ({
              key,
              input: b.input,
              output: b.output,
              cost: b.cost,
              tokens: b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning,
            }))
            .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
            .slice(0, 6)
          if (rows.length === 0) return null
          return (
            <>
              <h4 className={css.sectionTitle}>{t('preview.status.costByModel')}</h4>
              <ul className={css.itemList}>
                {rows.map((row) => (
                  <li key={row.key} className={css.itemRow}>
                    <span className={css.itemTitle}>{row.key}</span>
                    <span className={css.itemMeta}>
                      ${row.cost.toFixed(4)} · in {row.input} · out {row.output}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        })()}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.billing')}
        title={t('preview.status.billing')}
        signal={collapseSignal}
        meta={t('preview.status.billingScope')}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.billingToday')}</span>
          <span>
            ${status.billing.todayCost.toFixed(4)}
            {status.billing.todayTokens
              ? ` · ${status.billing.todayTokens} tok`
              : ''}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.billingMonth')}</span>
          <span>
            ${status.billing.monthCost.toFixed(4)}
            {status.billing.monthTokens
              ? ` · ${status.billing.monthTokens} tok`
              : ''}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.status.billingTotal')}</span>
          <span>${status.billing.totalCost.toFixed(4)}</span>
        </div>
        {status.billing.dailyTrend.length > 0
          ? (
            <div className={css.trend} aria-label={t('preview.status.billingTrend')}>
              <h4 className={css.sectionTitle}>{t('preview.status.billingTrend')}</h4>
              <div className={css.trendBars}>
                {(() => {
                  const days = status.billing.dailyTrend.slice(-14)
                  const max = Math.max(0.0001, ...days.map((d) => d.cost))
                  return days.map((day) => (
                    <div
                      key={day.date}
                      className={css.trendBar}
                      title={`${day.date}: $${day.cost.toFixed(4)} · ${day.tokens} tok`}
                      style={{ height: `${Math.max(8, Math.round((day.cost / max) * 40))}px` }}
                    />
                  ))
                })()}
              </div>
              <div className={css.itemMeta}>
                {status.billing.dailyTrend.slice(-7).map((d) => d.date.slice(5)).join(' · ')}
              </div>
            </div>
          )
          : null}
        {status.billing.byProviderModel.length === 0
          ? <div className={css.empty}>{t('preview.status.billingEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {status.billing.byProviderModel.slice(0, 6).map((row) => (
                <li key={row.key} className={css.itemRow}>
                  <span className={css.itemTitle}>{row.key}</span>
                  <span className={css.itemMeta}>
                    ${row.cost.toFixed(4)} · in {row.input} · out {row.output}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </SectionCard>

      <SectionCard
        t={t}
        label={t('preview.status.channels')}
        title={t('preview.status.channels')}
        signal={collapseSignal}
        meta={(
          <>
            {status.channels.process.length} process · {status.channels.im.length} im
            {wiredIm.length > 0 ? ` · ${wiredIm.length} gateway` : ''}
          </>
        )}
      >
        {status.channels.process.length === 0 && wiredIm.length === 0
          ? <div className={css.empty}>{t('preview.status.channelsEmpty')}</div>
          : (
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
          )}
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
                        className={css.linkBtn}
                        onClick={() => { void openSpillPath(row.spillPath!) }}
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
    </div>
  )
}

type RolloutView = {
  readonly counts: {
    readonly nodes: number
    readonly edges: number
    readonly spawn: number
    readonly message: number
    readonly tool: number
  }
  readonly sessions: readonly string[]
  readonly edges: readonly {
    readonly kind: string
    readonly from: string
    readonly to: string
    readonly label?: string
  }[]
}

function RolloutViewerPanel({
  sessionId,
  t,
}: {
  sessionId: string
  t: PreviewTabsProps['t']
}) {
  const [state, setState] = useState<RolloutView | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    setError(false)
    void fetch('/api/session.rolloutTrace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'preview-rollout',
        payload: { sessionId },
      }),
    })
      .then(async (res) => res.json() as Promise<unknown>)
      .then((body) => {
        if (!alive) return
        const envelope = body as { result?: { ok?: unknown; value?: unknown } }
        const value = envelope.result?.ok === true ? envelope.result.value : null
        if (!value || typeof value !== 'object') {
          setError(true)
          setState(null)
          return
        }
        const counts = (value as { counts?: RolloutView['counts'] }).counts
        const sessions = (value as { sessions?: unknown }).sessions
        const edges = (value as { edges?: unknown }).edges
        if (!counts || !Array.isArray(sessions) || !Array.isArray(edges)) {
          setError(true)
          setState(null)
          return
        }
        setState({
          counts,
          sessions: sessions.map(String),
          edges: edges.flatMap((row) => {
            if (!row || typeof row !== 'object') return []
            const kind = String((row as { kind?: unknown }).kind ?? '')
            const from = String((row as { from?: unknown }).from ?? '')
            const to = String((row as { to?: unknown }).to ?? '')
            if (!kind || !from || !to) return []
            const label = (row as { label?: unknown }).label
            return [{
              kind,
              from,
              to,
              ...(typeof label === 'string' && label ? { label } : {}),
            }]
          }),
        })
      })
      .catch(() => {
        if (!alive) return
        setError(true)
        setState(null)
      })
    return () => { alive = false }
  }, [sessionId])

  if (error) return <div className={css.empty}>{t('preview.rolloutUnavailable')}</div>
  if (!state) return <div className={css.empty}>{t('preview.loading')}</div>
  return (
    <div className={css.statusRoot}>
      <SectionCard
        t={t}
        label={t('preview.rollout')}
        title={t('preview.rollout')}
        meta={t('preview.rolloutHint')}
      >
        <div className={css.row}>
          <span className={css.label}>{t('preview.rolloutCounts')}</span>
          <span>
            nodes {state.counts.nodes} · edges {state.counts.edges}
            {' '}(spawn {state.counts.spawn} · msg {state.counts.message} · tool {state.counts.tool})
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>{t('preview.rolloutSessions')}</span>
          <span className={css.mono}>{state.sessions.slice(0, 6).join(', ') || '—'}</span>
        </div>
        {state.edges.length === 0
          ? <div className={css.empty}>{t('preview.rolloutEmpty')}</div>
          : (
            <ul className={css.itemList}>
              {state.edges.slice(0, 24).map((edge, i) => (
                <li key={`${edge.kind}-${edge.from}-${edge.to}-${i}`} className={css.itemRow}>
                  <span className={css.itemTitle}>{edge.kind}</span>
                  <span className={css.itemMeta}>
                    {edge.from} → {edge.to}
                    {edge.label ? ` · ${edge.label}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </SectionCard>
    </div>
  )
}

/**
 * Session Status / overview for the layout details column.
 * Default tab is Status (fleet · subagents · jobs · live contextTimeline · cost · channels),
 * fed by Face `session.status` — the same snapshot as slash `/status` — with
 * inject / compact / spill rows from the live `contextTimeline` projection.
 * Context / rollout / todos / plan / Office remain as secondary tabs.
 */
export function PreviewTabs({
  sessionId,
  closeDetails,
  openSpillPath,
  openTeamChild,
  pauseTeamChild,
  resumeTeamChild,
  t,
  useProjection,
}: PreviewTabsProps) {
  const [tab, setTab] = useState<PreviewTabId>('status')
  const [loaded, setLoaded] = useState<PreviewTabLoad>({
    plan: null,
    office: null,
    status: null,
  })
  const [ready, setReady] = useState(false)
  const [statusTick, setStatusTick] = useState(0)
  const plan = useProjection('plan') ?? loaded.plan
  // Face `todos` standing plan — keyed through host projections; cast keeps
  // this package free of a hard dependency on the todo stub types package.
  const todos = (useProjection as (key: string) => unknown)('todos') as TodoRow[] | null
  const office = loaded.office
  const status = loaded.status

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadPreviewTabs(sessionId).then((next) => {
      if (!alive) return
      setLoaded(next)
      setReady(true)
    })
    return () => { alive = false }
  }, [sessionId, statusTick])

  const refreshStatus = () => { setStatusTick((n) => n + 1) }

  const emptyCopy = ready ? t('preview.unavailable') : t('preview.loading')

  return (
    <aside className={css.root} aria-label={t('preview.tabs')} data-xrk-overview="" data-xrk-status="">
      <div className={css.header}>
        <div className={css.titleBlock}>
          <h2 className={css.title}>{t('preview.open')}</h2>
          <div className={css.tabs} role="tablist" aria-label={t('preview.tabs')}>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'status'}
              onClick={() => { setTab('status') }}
            >
              {t('preview.status')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'context'}
              onClick={() => { setTab('context') }}
            >
              {t('preview.context')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={tab === 'rollout'}
              onClick={() => { setTab('rollout') }}
            >
              {t('preview.rollout')}
            </button>
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
      <div className={css.body} role="tabpanel">
        {tab === 'status'
          ? status === null
            ? <div className={css.empty}>{emptyCopy}</div>
            : (
              <StatusPanel
                status={status}
                t={t}
                useProjection={useProjection}
                {...(openSpillPath ? { openSpillPath } : {})}
                {...(openTeamChild ? { openTeamChild } : {})}
                {...(pauseTeamChild ? { pauseTeamChild } : {})}
                {...(resumeTeamChild ? { resumeTeamChild } : {})}
                onTeamActionDone={refreshStatus}
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
            : tab === 'rollout'
              ? <RolloutViewerPanel sessionId={sessionId} t={t} />
              : tab === 'todos'
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
    </aside>
  )
}

/** Injected by ui-plan: open / close the layout details column. */
export interface PreviewOpenInjected {
  openPreview: () => void
  closePreview: () => void
}

export type PreviewOpenProps = InjectFace<PreviewOpenInjected> & PropsLocale<'plan'>

/**
 * Composer control that opens the session Status (details) column.
 * Reads the layout insets stamp (`data-xrk-layout-details`) so a second click
 * closes (toggle).
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
      className={css.open}
      onClick={() => { if (open) closePreview(); else openPreview() }}
      title={t('preview.openHint')}
      aria-label={t('preview.open')}
      aria-pressed={open}
      data-open={open || undefined}
    >
      {t('preview.open')}
    </button>
  )
}
