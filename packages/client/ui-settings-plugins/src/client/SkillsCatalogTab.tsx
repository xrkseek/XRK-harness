/** Session header Inject tab: skill.list + inject docs, searchable groups, body peek. */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  InjectDocumentEntry,
  SkillEntry,
  SkillListValue,
  SkillReadValue,
} from '@xrkseek/client-connection/client'
import type { SessionId } from '@xrkseek/xrk-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import {
  paintSkillsCatalog,
  rememberCatalog,
  rememberSkillsCatalog,
  skillBodyCache,
  skillsChromeBySession,
  writeChrome,
} from './catalog-session-cache.ts'
import css from './CatalogListTab.module.css'

/** Selection-key prefixes for catalog rows (must match `slice` lengths below). */
const DOC_ITEM_PREFIX = 'doc:'
const SKILL_ITEM_PREFIX = 'skill:'

/** Injected face for the skills catalog tab. */
export interface SkillsCatalogTabInjected {
  currentSessionId: () => string | undefined
  listSkills: (
    sessionId: SessionId,
    signal?: AbortSignal,
  ) => Promise<SkillListValue>
  readSkill: (
    sessionId: SessionId,
    selector: { name: string } | { document: string },
    signal?: AbortSignal,
  ) => Promise<SkillReadValue>
}

export type SkillsCatalogTabProps =
  PropsLocale<'settings.plugins'>
  & InjectFace<SkillsCatalogTabInjected>
  & Partial<PropsRuntime<'settings.plugins.tab'>>

type ViewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly value: SkillListValue }

/** Filter chips: product roots (.xrk / .agents) plus catch-all other vendors. */
type SkillFilter =
  | 'all'
  | 'documents'
  | 'workspace-xrk'
  | 'workspace-agents'
  | 'home-xrk'
  | 'home-agents'
  | 'other'

type SkillLayer = 'workspace' | 'home' | 'other'
type SkillVendor = 'xrk' | 'agents' | 'cursor' | 'claude' | 'codex' | 'other'

type SkillGroup = {
  readonly key: string
  readonly layer: SkillLayer
  readonly vendor: SkillVendor
  readonly label: string
  readonly path: string
  readonly skills: readonly SkillEntry[]
}

type BodyState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly content: string }

function skillLayer(skill: SkillEntry): SkillLayer {
  const layer = skill.source?.layer
  if (layer === 'workspace' || layer === 'home' || layer === 'other') return layer
  return 'other'
}

function skillVendor(skill: SkillEntry): SkillVendor {
  const vendor = skill.source?.vendor
  if (
    vendor === 'xrk'
    || vendor === 'agents'
    || vendor === 'cursor'
    || vendor === 'claude'
    || vendor === 'codex'
  ) {
    return vendor
  }
  return 'other'
}

/** Map a skill onto a filter chip (xrk/agents get dedicated chips; rest → other). */
function skillFilterId(skill: SkillEntry): Exclude<SkillFilter, 'all' | 'documents'> {
  const layer = skillLayer(skill)
  const vendor = skillVendor(skill)
  if (layer === 'workspace' && vendor === 'xrk') return 'workspace-xrk'
  if (layer === 'workspace' && vendor === 'agents') return 'workspace-agents'
  if (layer === 'home' && vendor === 'xrk') return 'home-xrk'
  if (layer === 'home' && vendor === 'agents') return 'home-agents'
  return 'other'
}

function vendorMark(
  vendor: SkillVendor,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): string {
  if (vendor === 'xrk') return t('skillsVendorXrk')
  if (vendor === 'agents') return t('skillsVendorAgents')
  if (vendor === 'cursor') return t('skillsVendorCursor')
  if (vendor === 'claude') return t('skillsVendorClaude')
  if (vendor === 'codex') return t('skillsVendorCodex')
  return t('skillsVendorOther')
}

/** Group title: 「工作区 .xrk Skills」/「主 .agents Skills」— mirrors the disk root. */
function skillGroupLabel(
  layer: SkillLayer,
  vendor: SkillVendor,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): string {
  if (layer === 'other' && vendor === 'other') return t('skillsGroupOther')
  const scope = layer === 'workspace'
    ? t('skillsScopeWorkspace')
    : layer === 'home'
      ? t('skillsScopeHome')
      : t('skillsScopeOther')
  const mark = vendorMark(vendor, t)
  return mark
    ? t('skillsGroupByRoot', { scope, vendor: mark })
    : t('skillsGroupOther')
}

/** Standing-doc badge: prefer .xrk / .agents when the path says so. */
function documentOriginLabel(
  doc: InjectDocumentEntry,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): string {
  if (doc.layer === 'session') return t('skillsFilterSession')
  const p = doc.path.replace(/\\/g, '/')
  const agents = /(^|\/)\.agents(\/|$)/.test(p) || p.startsWith('~/.agents')
  const xrk = /(^|\/)\.xrk(\/|$)/.test(p) || p.startsWith('~/.xrk')
  if (doc.layer === 'home') {
    if (agents) return t('skillsFilterHomeAgents')
    if (xrk) return t('skillsFilterHomeXrk')
    return t('skillsFilterHome')
  }
  if (agents) return t('skillsFilterWorkspaceAgents')
  if (xrk) return t('skillsFilterWorkspaceXrk')
  return t('skillsFilterWorkspace')
}

function matchesSkill(skill: SkillEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return skill.name.toLowerCase().includes(q)
    || skill.description.toLowerCase().includes(q)
    || (skill.source?.root.toLowerCase().includes(q) ?? false)
    || (skill.source?.vendor.toLowerCase().includes(q) ?? false)
}

function documentTitle(
  doc: InjectDocumentEntry,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): string {
  if (doc.path === 'skills://catalog') return t('skillsCatalogPathLabel')
  if (doc.path === 'session://capability') return t('skillsCapabilityPathLabel')
  if (doc.path === 'session://posture') return t('skillsPosturePathLabel')
  if (doc.path === 'session://collab-board') return t('skillsCollabPathLabel')
  return doc.path
}

function documentKindLabel(
  doc: InjectDocumentEntry,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): string {
  if (doc.kind === 'skill-catalog') return t('skillsDocumentKindCatalog')
  if (doc.kind === 'session-capability') return t('skillsDocumentKindCapability')
  if (doc.kind === 'session-posture') return t('skillsDocumentKindPosture')
  if (doc.kind === 'collab-board') return t('skillsDocumentKindCollab')
  return t('skillsDocumentKindInstruction')
}

function matchesDocument(doc: InjectDocumentEntry, query: string): boolean {
  if (!query) return true
  return doc.path.toLowerCase().includes(query.toLowerCase())
}

function groupSkills(
  skills: readonly SkillEntry[],
  filter: SkillFilter,
  query: string,
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
): readonly SkillGroup[] {
  if (filter === 'documents') return []
  const buckets = new Map<string, SkillEntry[]>()
  const meta = new Map<string, {
    layer: SkillLayer
    vendor: SkillVendor
    root: string
    label: string
  }>()
  for (const skill of skills) {
    const layer = skillLayer(skill)
    const vendor = skillVendor(skill)
    if (filter !== 'all' && skillFilterId(skill) !== filter) continue
    if (!matchesSkill(skill, query)) continue
    const root = skill.source?.root ?? 'skills'
    const key = `${layer}:${vendor}:${root}`
    const list = buckets.get(key) ?? []
    list.push(skill)
    buckets.set(key, list)
    if (!meta.has(key)) {
      meta.set(key, {
        layer,
        vendor,
        root,
        label: skillGroupLabel(layer, vendor, t),
      })
    }
  }
  const layerOrder = (layer: SkillLayer) =>
    layer === 'workspace' ? 0 : layer === 'home' ? 1 : 2
  const vendorOrder = (vendor: SkillVendor) =>
    vendor === 'xrk' ? 0
      : vendor === 'agents' ? 1
        : vendor === 'cursor' ? 2
          : vendor === 'claude' ? 3
            : vendor === 'codex' ? 4
              : 5
  return [...buckets.entries()]
    .map(([key, rows]) => {
      const info = meta.get(key)!
      return {
        key,
        layer: info.layer,
        vendor: info.vendor,
        label: info.label,
        path: info.root,
        skills: rows.toSorted((a, b) => a.name.localeCompare(b.name)),
      }
    })
    .toSorted((a, b) => {
      const byLayer = layerOrder(a.layer) - layerOrder(b.layer)
      if (byLayer !== 0) return byLayer
      const byVendor = vendorOrder(a.vendor) - vendorOrder(b.vendor)
      if (byVendor !== 0) return byVendor
      return a.path.localeCompare(b.path)
    })
}

const DEFAULT_SKILL_GROUPS = ['session-docs', 'documents'] as const

/** One session's inject catalog. Remounted per sessionId so chrome cannot bleed. */
function SkillsCatalogSession({
  t,
  sessionId,
  listSkills,
  readSkill,
}: SkillsCatalogTabProps & { sessionId: string }): ReactNode {
  const searchId = useId()
  const stored = skillsChromeBySession.get(sessionId)
  const painted = paintSkillsCatalog(sessionId)
  const cached = painted?.value as SkillListValue | undefined
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState(stored?.query ?? '')
  const [filter, setFilter] = useState<SkillFilter>((stored?.filter as SkillFilter | undefined) ?? 'all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(stored?.expanded ?? DEFAULT_SKILL_GROUPS),
  )
  const [activeKey, setActiveKey] = useState<string | null>(stored?.open ?? null)
  const [refreshing, setRefreshing] = useState(painted !== undefined && !painted.owned)
  const [body, setBody] = useState<BodyState | null>(null)
  const [state, setState] = useState<ViewState>(
    cached ? { status: 'ready', value: cached } : { status: 'loading' },
  )

  useEffect(() => {
    writeChrome(skillsChromeBySession, sessionId, {
      query,
      filter,
      expanded: [...expanded],
      open: activeKey,
    })
  }, [sessionId, query, filter, expanded, activeKey])

  useEffect(() => {
    let current = true
    const abort = new AbortController()
    const had = paintSkillsCatalog(sessionId)
    if (had === undefined) setState({ status: 'loading' })
    else setRefreshing(true)
    void listSkills(sessionId as SessionId, abort.signal).then(
      (value) => {
        if (!current) return
        rememberSkillsCatalog(sessionId, value)
        setState({ status: 'ready', value })
        setRefreshing(false)
      },
      (error: unknown) => {
        if (!current) return
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        if (cancelled) return
        setRefreshing(false)
        if (paintSkillsCatalog(sessionId) !== undefined) return
        const message = error instanceof Error ? error.message : undefined
        setState({ status: 'error', message })
      },
    )
    return () => {
      current = false
      abort.abort()
    }
  }, [sessionId, tick, listSkills])

  useEffect(() => {
    if (!activeKey) {
      setBody(null)
      return
    }
    const bodyKey = `${sessionId}\0${activeKey}`
    const cachedBody = skillBodyCache.get(bodyKey)
    let current = true
    const abort = new AbortController()
    setBody(cachedBody !== undefined
      ? { status: 'ready', content: cachedBody }
      : { status: 'loading' })
    const selector = activeKey.startsWith(DOC_ITEM_PREFIX)
      ? { document: activeKey.slice(DOC_ITEM_PREFIX.length) }
      : { name: activeKey.slice(SKILL_ITEM_PREFIX.length) }
    void readSkill(sessionId as SessionId, selector, abort.signal).then(
      (value) => {
        if (!current) return
        rememberCatalog(skillBodyCache, bodyKey, value.content)
        setBody({ status: 'ready', content: value.content })
      },
      (error: unknown) => {
        if (!current) return
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        if (cancelled) return
        if (skillBodyCache.has(bodyKey)) return
        const message = error instanceof Error ? error.message : String(error)
        setBody({ status: 'error', message })
      },
    )
    return () => {
      current = false
      abort.abort()
    }
  }, [sessionId, activeKey, readSkill])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    return groupSkills(
      state.value.skills,
      filter,
      query.trim(),
      t,
    )
  }, [state, filter, query, t])

  const documents = useMemo(() => {
    if (state.status !== 'ready') return []
    if (filter !== 'all' && filter !== 'documents') return []
    return state.value.documents.filter((doc) => matchesDocument(doc, query.trim()))
  }, [state, filter, query])

  const counts = useMemo(() => {
    const empty = {
      all: 0,
      'workspace-xrk': 0,
      'workspace-agents': 0,
      'home-xrk': 0,
      'home-agents': 0,
      other: 0,
      documents: 0,
    }
    if (state.status !== 'ready') return empty
    const next = { ...empty, documents: state.value.documents.length, all: state.value.skills.length }
    for (const skill of state.value.skills) {
      next[skillFilterId(skill)] += 1
    }
    return next
  }, [state])

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openItem = (key: string) => {
    setActiveKey((prev) => (prev === key ? null : key))
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className={css.root}>
        <p className={css.lead}>{t('skillsCatalogLead')}</p>
        <p className={css.status}>{t('catalogLoading')}</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={css.root}>
        <p className={css.lead}>{t('skillsCatalogLead')}</p>
        <p className={css.status} role="alert">{t('catalogError')}</p>
        {state.message ? <p className={css.errorDetail}>{state.message}</p> : null}
        <button type="button" className={css.retry} onClick={() => setTick((n) => n + 1)}>
          {t('catalogRetry')}
        </button>
      </div>
    )
  }

  const filters: { id: SkillFilter; label: string; count: number }[] = [
    { id: 'all', label: t('catalogFilterAll'), count: counts.all },
    { id: 'documents', label: t('skillsFilterDocuments'), count: counts.documents },
    { id: 'workspace-xrk', label: t('skillsFilterWorkspaceXrk'), count: counts['workspace-xrk'] },
    { id: 'workspace-agents', label: t('skillsFilterWorkspaceAgents'), count: counts['workspace-agents'] },
    { id: 'home-xrk', label: t('skillsFilterHomeXrk'), count: counts['home-xrk'] },
    { id: 'home-agents', label: t('skillsFilterHomeAgents'), count: counts['home-agents'] },
    { id: 'other', label: t('skillsFilterOther'), count: counts.other },
  ]

  return (
    <div className={clsx(css.root, refreshing && css.rootRefreshing)} aria-busy={refreshing}>
      <p className={css.lead}>{t('skillsCatalogLead')}</p>
      <p className={css.workspace} title={state.value.workspace.cwd}>
        {t('catalogWorkspace', { label: state.value.workspace.label })}
        <span className={css.workspacePath}>{state.value.workspace.cwd}</span>
      </p>

      <div className={css.toolbar}>
        <p className={css.meta}>
          {t('skillsCatalogMeta', {
            count: String(state.value.skills.length),
            docs: String(state.value.documents.length),
          })}
        </p>
        <button
          type="button"
          className={css.refresh}
          onClick={() => setTick((n) => n + 1)}
          aria-label={t('catalogRefresh')}
        >
          {t('catalogRefresh')}
        </button>
      </div>

      <label className={css.search} htmlFor={searchId}>
        <span className={css.visuallyHidden}>{t('catalogSearch')}</span>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder={t('catalogSearch')}
          aria-label={t('catalogSearch')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </label>

      <div className={css.filterRow} role="toolbar" aria-label={t('skillsTab')}>
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            className={css.filterChip}
            data-active={filter === item.id ? 'true' : undefined}
            aria-pressed={filter === item.id}
            onClick={() => { setFilter(item.id) }}
          >
            {item.label}
            <span className={css.filterCount}>{item.count}</span>
          </button>
        ))}
      </div>

      {documents.some((doc) => doc.layer === 'session') ? (
        <section className={css.group} data-layer="session">
          <button
            type="button"
            className={css.groupHeader}
            aria-expanded={expanded.has('session-docs')}
            onClick={() => { toggleGroup('session-docs') }}
          >
            <span
              className={css.groupChevron}
              data-open={expanded.has('session-docs') ? 'true' : undefined}
              aria-hidden="true"
            />
            <span className={css.groupTitleBlock}>
              <span className={css.groupTitle}>{t('skillsSessionDocumentsTitle')}</span>
              <span className={css.groupPath}>{t('skillsSessionDocumentsHint')}</span>
            </span>
            <span className={css.groupCount}>
              {documents.filter((doc) => doc.layer === 'session').length}
            </span>
          </button>
          {expanded.has('session-docs') ? (
            <ul className={css.list}>
              {documents.filter((doc) => doc.layer === 'session').map((doc) => (
                <DocumentRow
                  key={doc.path}
                  doc={doc}
                  open={activeKey === `${DOC_ITEM_PREFIX}${doc.path}`}
                  body={body}
                  t={t}
                  onOpen={() => { openItem(`${DOC_ITEM_PREFIX}${doc.path}`) }}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {documents.some((doc) => doc.layer !== 'session') ? (
        <section className={css.group} data-layer="documents">
          <button
            type="button"
            className={css.groupHeader}
            aria-expanded={expanded.has('documents')}
            onClick={() => { toggleGroup('documents') }}
          >
            <span
              className={css.groupChevron}
              data-open={expanded.has('documents') ? 'true' : undefined}
              aria-hidden="true"
            />
            <span className={css.groupTitleBlock}>
              <span className={css.groupTitle}>{t('skillsDocumentsTitle')}</span>
              <span className={css.groupPath}>{t('skillsDocumentsHint')}</span>
            </span>
            <span className={css.groupCount}>
              {documents.filter((doc) => doc.layer !== 'session').length}
            </span>
          </button>
          {expanded.has('documents') ? (
            <ul className={css.list}>
              {documents.filter((doc) => doc.layer !== 'session').map((doc) => (
                <DocumentRow
                  key={doc.path}
                  doc={doc}
                  open={activeKey === `${DOC_ITEM_PREFIX}${doc.path}`}
                  body={body}
                  t={t}
                  onOpen={() => { openItem(`${DOC_ITEM_PREFIX}${doc.path}`) }}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {groups.length === 0 && documents.length === 0 ? (
        <p className={css.status}>
          {state.value.skills.length === 0 && state.value.documents.length === 0
            ? t('skillsCatalogEmpty')
            : t('catalogNoMatch')}
        </p>
      ) : (
        groups.map((group) => {
          const open = expanded.has(group.key)
          return (
            <section
              key={group.key}
              className={css.group}
              data-layer={group.layer}
              data-vendor={group.vendor}
            >
              <button
                type="button"
                className={css.groupHeader}
                aria-expanded={open}
                onClick={() => { toggleGroup(group.key) }}
              >
                <span className={css.groupChevron} data-open={open ? 'true' : undefined} aria-hidden="true" />
                <span className={css.groupTitleBlock}>
                  <span className={css.groupTitle}>{group.label}</span>
                  <span className={css.groupPath}>{group.path}</span>
                </span>
                <span className={css.groupCount}>{group.skills.length}</span>
              </button>
              {open ? (
                <ul className={css.list}>
                  {group.skills.map((skill) => {
                    const key = `${SKILL_ITEM_PREFIX}${skill.name}`
                    const detailOpen = activeKey === key
                    return (
                      <li key={skill.name} className={css.row}>
                        <button
                          type="button"
                          className={css.rowButton}
                          aria-expanded={detailOpen}
                          onClick={() => { openItem(key) }}
                        >
                          <div className={css.rowHead}>
                            <p className={css.name}>/{skill.name}</p>
                            {skill.source?.vendor && skill.source.vendor !== 'other' ? (
                              <span className={css.badge}>{skill.source.vendor}</span>
                            ) : null}
                            {!skill.modelInvocable ? (
                              <span className={css.badgeMuted}>{t('skillsUserOnly')}</span>
                            ) : null}
                          </div>
                          {skill.description && !detailOpen ? (
                            <p className={css.desc}>{skill.description}</p>
                          ) : null}
                        </button>
                        {detailOpen ? <BodyPanel body={body} t={t} /> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>
          )
        })
      )}
    </div>
  )
}

/** Inject catalog for the conversation-view session. Each session remounts. */
export function SkillsCatalogTab({
  currentSessionId,
  ...rest
}: SkillsCatalogTabProps): ReactNode {
  const sessionId = currentSessionId()
  if (!sessionId) {
    return (
      <div className={css.root}>
        <p className={css.lead}>{rest.t('skillsCatalogLead')}</p>
        <p className={css.status}>{rest.t('catalogNoSession')}</p>
      </div>
    )
  }
  return (
    <SkillsCatalogSession
      key={sessionId}
      {...rest}
      currentSessionId={currentSessionId}
      sessionId={sessionId}
    />
  )
}

function DocumentRow({
  doc,
  open,
  body,
  t,
  onOpen,
}: {
  doc: InjectDocumentEntry
  open: boolean
  body: BodyState | null
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string
  onOpen: () => void
}): ReactNode {
  const layerLabel = documentOriginLabel(doc, t)
  return (
    <li className={css.row}>
      <button
        type="button"
        className={css.rowButton}
        aria-expanded={open}
        onClick={onOpen}
      >
        <div className={css.rowHead}>
          <p className={css.name}>{documentTitle(doc, t)}</p>
          <span className={css.badge}>{documentKindLabel(doc, t)}</span>
          <span className={css.badgeMuted}>{layerLabel}</span>
        </div>
        <p className={css.desc}>
          {doc.path === 'skills://catalog' ? null : `${doc.path} · `}
          {t('skillsDocumentBytes', { bytes: String(doc.bytes) })}
        </p>
      </button>
      {open ? <BodyPanel body={body} t={t} /> : null}
    </li>
  )
}

function BodyPanel({
  body,
  t,
}: {
  body: BodyState | null
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string
}): ReactNode {
  if (!body || body.status === 'loading') {
    return <p className={css.status}>{t('catalogLoading')}</p>
  }
  if (body.status === 'error') {
    return <p className={css.errorDetail} role="alert">{body.message}</p>
  }
  if (!body.content.trim()) {
    return <p className={css.status}>{t('catalogNoBody')}</p>
  }
  return <pre className={css.body}>{body.content}</pre>
}
