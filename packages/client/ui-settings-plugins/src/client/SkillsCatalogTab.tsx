/** Plugins tab: skill.list + inject docs, with searchable groups and full-body peek. */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  InjectDocumentEntry,
  SkillEntry,
  SkillListValue,
  SkillReadValue,
} from '@xrkseek/client-connection/client'
import type { SessionId } from '@xrkseek/xrk-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './CatalogListTab.module.css'

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
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SkillsCatalogTabInjected>

type ViewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly value: SkillListValue }

type SkillFilter = 'all' | 'workspace' | 'home' | 'other' | 'documents'

type SkillGroup = {
  readonly key: string
  readonly layer: Exclude<SkillFilter, 'all' | 'documents'>
  readonly label: string
  readonly path: string
  readonly skills: readonly SkillEntry[]
}

type BodyState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly content: string }

function skillLayer(skill: SkillEntry): Exclude<SkillFilter, 'all' | 'documents'> {
  const layer = skill.source?.layer
  if (layer === 'workspace' || layer === 'home' || layer === 'other') return layer
  return 'other'
}

function matchesSkill(skill: SkillEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return skill.name.toLowerCase().includes(q)
    || skill.description.toLowerCase().includes(q)
    || (skill.source?.root.toLowerCase().includes(q) ?? false)
    || (skill.source?.vendor.toLowerCase().includes(q) ?? false)
}

function matchesDocument(doc: InjectDocumentEntry, query: string): boolean {
  if (!query) return true
  return doc.path.toLowerCase().includes(query.toLowerCase())
}

function groupSkills(
  skills: readonly SkillEntry[],
  filter: SkillFilter,
  query: string,
  labelFor: (layer: Exclude<SkillFilter, 'all' | 'documents'>) => string,
): readonly SkillGroup[] {
  if (filter === 'documents') return []
  const buckets = new Map<string, SkillEntry[]>()
  const meta = new Map<string, { layer: Exclude<SkillFilter, 'all' | 'documents'>; root: string; label: string }>()
  for (const skill of skills) {
    const layer = skillLayer(skill)
    if (filter !== 'all' && layer !== filter) continue
    if (!matchesSkill(skill, query)) continue
    const root = skill.source?.root ?? 'skills'
    const key = `${layer}:${root}`
    const list = buckets.get(key) ?? []
    list.push(skill)
    buckets.set(key, list)
    if (!meta.has(key)) {
      meta.set(key, { layer, root, label: labelFor(layer) })
    }
  }
  const order = (layer: string) =>
    layer === 'workspace' ? 0 : layer === 'home' ? 1 : 2
  return [...buckets.entries()]
    .map(([key, rows]) => {
      const info = meta.get(key)!
      return {
        key,
        layer: info.layer,
        label: info.label,
        path: info.root,
        skills: rows.toSorted((a, b) => a.name.localeCompare(b.name)),
      }
    })
    .toSorted((a, b) => {
      const byLayer = order(a.layer) - order(b.layer)
      if (byLayer !== 0) return byLayer
      return a.path.localeCompare(b.path)
    })
}

/** Render the skill directory for the current session cwd. */
export function SkillsCatalogTab({
  t,
  currentSessionId,
  listSkills,
  readSkill,
}: SkillsCatalogTabProps): ReactNode {
  const searchId = useId()
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['documents']))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [body, setBody] = useState<BodyState | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'idle' })
  const sessionId = currentSessionId()

  useEffect(() => {
    if (!sessionId) {
      setState({ status: 'idle' })
      return
    }
    let current = true
    const abort = new AbortController()
    setState({ status: 'loading' })
    void listSkills(sessionId as SessionId, abort.signal).then(
      (value) => {
        if (!current) return
        setState({ status: 'ready', value })
        setExpanded(new Set(['documents']))
        setActiveKey(null)
        setBody(null)
      },
      (error: unknown) => {
        if (!current) return
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        if (cancelled) return
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
    if (!sessionId || !activeKey) {
      setBody(null)
      return
    }
    let current = true
    const abort = new AbortController()
    setBody({ status: 'loading' })
    const selector = activeKey.startsWith('doc:')
      ? { document: activeKey.slice(4) }
      : { name: activeKey.slice(7) }
    void readSkill(sessionId as SessionId, selector, abort.signal).then(
      (value) => {
        if (!current) return
        setBody({ status: 'ready', content: value.content })
      },
      (error: unknown) => {
        if (!current) return
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        if (cancelled) return
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
      (layer) => {
        if (layer === 'home') return t('skillsGroupHome')
        if (layer === 'workspace') return t('skillsGroupWorkspace')
        return t('skillsGroupOther')
      },
    )
  }, [state, filter, query, t])

  const documents = useMemo(() => {
    if (state.status !== 'ready') return []
    if (filter !== 'all' && filter !== 'documents') return []
    return state.value.documents.filter((doc) => matchesDocument(doc, query.trim()))
  }, [state, filter, query])

  const counts = useMemo(() => {
    if (state.status !== 'ready') {
      return { all: 0, workspace: 0, home: 0, other: 0, documents: 0 }
    }
    let workspace = 0
    let home = 0
    let other = 0
    for (const skill of state.value.skills) {
      const layer = skillLayer(skill)
      if (layer === 'workspace') workspace += 1
      else if (layer === 'home') home += 1
      else other += 1
    }
    return {
      all: state.value.skills.length,
      workspace,
      home,
      other,
      documents: state.value.documents.length,
    }
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

  if (!sessionId) {
    return <p className={css.status}>{t('catalogNoSession')}</p>
  }
  if (state.status === 'loading' || state.status === 'idle') {
    return <p className={css.status}>{t('catalogLoading')}</p>
  }
  if (state.status === 'error') {
    return (
      <div className={css.root}>
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
    { id: 'workspace', label: t('skillsFilterWorkspace'), count: counts.workspace },
    { id: 'home', label: t('skillsFilterHome'), count: counts.home },
    { id: 'other', label: t('skillsFilterOther'), count: counts.other },
  ]

  return (
    <div className={css.root}>
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

      {documents.length > 0 ? (
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
            <span className={css.groupCount}>{documents.length}</span>
          </button>
          {expanded.has('documents') ? (
            <ul className={css.list}>
              {documents.map((doc) => {
                const key = `doc:${doc.path}`
                const open = activeKey === key
                const title = doc.path === 'skills://catalog'
                  ? t('skillsCatalogPathLabel')
                  : doc.path
                return (
                  <li key={doc.path} className={css.row}>
                    <button
                      type="button"
                      className={css.rowButton}
                      aria-expanded={open}
                      onClick={() => { openItem(key) }}
                    >
                      <div className={css.rowHead}>
                        <p className={css.name}>{title}</p>
                        <span className={css.badge}>
                          {doc.kind === 'skill-catalog'
                            ? t('skillsDocumentKindCatalog')
                            : t('skillsDocumentKindInstruction')}
                        </span>
                        <span className={css.badgeMuted}>
                          {doc.layer === 'home' ? t('skillsFilterHome') : t('skillsFilterWorkspace')}
                        </span>
                      </div>
                      <p className={css.desc}>
                        {doc.path === 'skills://catalog' ? null : `${doc.path} · `}
                        {t('skillsDocumentBytes', { bytes: String(doc.bytes) })}
                      </p>
                    </button>
                    {open ? <BodyPanel body={body} t={t} /> : null}
                  </li>
                )
              })}
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
            <section key={group.key} className={css.group} data-layer={group.layer}>
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
                    const key = `skill:${skill.name}`
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
