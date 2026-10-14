/** Plugins tab: live session tool catalog with search, surface chips, collapsible groups. */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  SessionId,
  SessionToolEntry,
  SessionToolSurface,
  SessionToolsValue,
} from '@xrkseek/client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './CatalogListTab.module.css'

function surfaceLabel(
  t: (key: PluginsSettingsLocaleKey, params?: Record<string, string>) => string,
  surface: SessionToolSurface,
): string {
  switch (surface) {
    case 'filesystem': return t('toolsSurface_filesystem')
    case 'shell': return t('toolsSurface_shell')
    case 'browser': return t('toolsSurface_browser')
    case 'web': return t('toolsSurface_web')
    case 'mcp': return t('toolsSurface_mcp')
    case 'agent': return t('toolsSurface_agent')
    case 'media': return t('toolsSurface_media')
    case 'settings': return t('toolsSurface_settings')
    case 'ui': return t('toolsSurface_ui')
    default: return t('toolsSurface_other')
  }
}

/** Injected face for the tools catalog tab. */
export interface ToolsCatalogTabInjected {
  currentSessionId: () => string | undefined
  listTools: (
    sessionId: SessionId,
    signal?: AbortSignal,
  ) => Promise<SessionToolsValue>
}

export type ToolsCatalogTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ToolsCatalogTabInjected>

type ViewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly value: SessionToolsValue }

type ToolFilter = 'all' | SessionToolSurface

type ToolGroup = {
  readonly key: string
  readonly surface: SessionToolSurface
  readonly label: string
  readonly tools: readonly SessionToolEntry[]
}

const SURFACE_ORDER: readonly SessionToolSurface[] = [
  'filesystem', 'shell', 'browser', 'web', 'agent', 'media', 'settings', 'ui', 'mcp', 'other',
]

function matchesQuery(tool: SessionToolEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return tool.name.toLowerCase().includes(q)
    || tool.description.toLowerCase().includes(q)
    || tool.surface.toLowerCase().includes(q)
    || (tool.mcpServer?.toLowerCase().includes(q) ?? false)
}

function groupTools(
  tools: readonly SessionToolEntry[],
  filter: ToolFilter,
  query: string,
  labelSurface: (surface: SessionToolSurface) => string,
  labelMcpServer: (server: string) => string,
  labelMcpOther: string,
): readonly ToolGroup[] {
  const filtered = tools.filter((tool) => {
    if (filter !== 'all' && tool.surface !== filter) return false
    return matchesQuery(tool, query)
  })
  const byKey = new Map<string, {
    surface: SessionToolSurface
    label: string
    tools: SessionToolEntry[]
  }>()
  for (const tool of filtered) {
    const key = tool.surface === 'mcp'
      ? `mcp:${tool.mcpServer?.trim() || '_'}`
      : `surface:${tool.surface}`
    const label = tool.surface === 'mcp'
      ? (tool.mcpServer?.trim()
        ? labelMcpServer(tool.mcpServer.trim())
        : labelMcpOther)
      : labelSurface(tool.surface)
    const bucket = byKey.get(key) ?? { surface: tool.surface, label, tools: [] }
    bucket.tools.push(tool)
    byKey.set(key, bucket)
  }
  const surfaceRank = (s: SessionToolSurface) => {
    const i = SURFACE_ORDER.indexOf(s)
    return i < 0 ? SURFACE_ORDER.length : i
  }
  return [...byKey.entries()]
    .map(([key, row]) => ({
      key,
      surface: row.surface,
      label: row.label,
      tools: row.tools.toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
    .toSorted((a, b) => {
      const bySurface = surfaceRank(a.surface) - surfaceRank(b.surface)
      if (bySurface !== 0) return bySurface
      return a.label.localeCompare(b.label)
    })
}

/** Render the session tools directory. */
export function ToolsCatalogTab({
  t,
  currentSessionId,
  listTools,
}: ToolsCatalogTabProps): ReactNode {
  const searchId = useId()
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ToolFilter>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [openTool, setOpenTool] = useState<string | null>(null)
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
    void listTools(sessionId as SessionId, abort.signal).then(
      (value) => {
        if (!current) return
        setState({ status: 'ready', value })
        setExpanded(new Set())
        setOpenTool(null)
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
  }, [sessionId, tick, listTools])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    return groupTools(
      state.value.tools,
      filter,
      query.trim(),
      (surface) => surfaceLabel(t, surface),
      (server) => t('toolsGroupMcpServer', { server }),
      t('toolsGroupMcpOther'),
    )
  }, [state, filter, query, t])

  const surfaceCounts = useMemo(() => {
    const counts = new Map<SessionToolSurface, number>()
    if (state.status !== 'ready') return counts
    for (const tool of state.value.tools) {
      counts.set(tool.surface, (counts.get(tool.surface) ?? 0) + 1)
    }
    return counts
  }, [state])

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  const filters: { id: ToolFilter; label: string; count: number }[] = [
    { id: 'all', label: t('catalogFilterAll'), count: state.value.tools.length },
    ...SURFACE_ORDER
      .filter((surface) => (surfaceCounts.get(surface) ?? 0) > 0)
      .map((surface) => ({
        id: surface as ToolFilter,
        label: surfaceLabel(t, surface),
        count: surfaceCounts.get(surface) ?? 0,
      })),
  ]

  return (
    <div className={css.root}>
      <p className={css.workspace} title={state.value.cwd}>
        {t('catalogWorkspace', { label: state.value.workspaceLabel })}
        <span className={css.workspacePath}>{state.value.cwd}</span>
      </p>

      <div className={css.toolbar}>
        <p className={css.meta}>
          {t('toolsCatalogMeta', {
            preset: state.value.agentPreset,
            count: String(state.value.tools.length),
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

      <div className={css.filterRow} role="toolbar" aria-label={t('toolsTab')}>
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

      {groups.length === 0 ? (
        <p className={css.status}>
          {state.value.tools.length === 0 ? t('toolsCatalogEmpty') : t('catalogNoMatch')}
        </p>
      ) : (
        groups.map((group) => {
          const open = expanded.has(group.key)
          return (
            <section key={group.key} className={css.group} data-surface={group.surface}>
              <button
                type="button"
                className={css.groupHeader}
                aria-expanded={open}
                onClick={() => { toggleGroup(group.key) }}
              >
                <span className={css.groupChevron} data-open={open ? 'true' : undefined} aria-hidden="true" />
                <span className={css.groupTitle}>{group.label}</span>
                <span className={css.groupCount}>{group.tools.length}</span>
              </button>
              {open ? (
                <ul className={css.list}>
                  {group.tools.map((tool) => {
                    const detailOpen = openTool === tool.name
                    return (
                      <li key={tool.name} className={css.row}>
                        <button
                          type="button"
                          className={css.rowButton}
                          aria-expanded={detailOpen}
                          onClick={() => {
                            setOpenTool((prev) => (prev === tool.name ? null : tool.name))
                          }}
                        >
                          <div className={css.rowHead}>
                            <p className={css.name}>{tool.name}</p>
                            <span className={css.badgeMuted}>{surfaceLabel(t, tool.surface)}</span>
                            {tool.exposure === 'deferred' ? (
                              <span className={css.badge}>{t('toolsExposureDeferred')}</span>
                            ) : null}
                          </div>
                          {tool.description && !detailOpen ? (
                            <p className={css.desc}>{tool.description}</p>
                          ) : null}
                        </button>
                        {detailOpen ? (
                          <pre className={css.body}>{tool.description || t('catalogNoBody')}</pre>
                        ) : null}
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
