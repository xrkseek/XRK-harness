import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginEntryId, PluginInventorySnapshot } from '@xrkseek/xrk-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@xrkseek/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /** Soft-disable / re-enable a managed plugin. */
  setEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<void>
  /** Remove a managed plugin from the CLI inventory. */
  remove: (entryId: PluginEntryId) => Promise<void>
  /** Reinstall / bump a managed plugin from its install source. */
  update: (entryId: PluginEntryId) => Promise<void>
  /** Open the managed plugin install folder in the OS. */
  open: (entryId: PluginEntryId) => Promise<void>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']
type CatalogFilter = 'all' | 'custom' | 'disabled'

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
    .replace(/^client-/, '')
    .replace(/^xrk-/, '')
    .replace(/^xrkh-/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId, entry.version, entry.kind, entry.source]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

function matchesFilter(entry: PluginInventoryEntry, filter: CatalogFilter): boolean {
  if (filter === 'custom') return entry.managed === true
  if (filter === 'disabled') return entry.enabled === false
  return true
}

/** Render the Host plugin inventory (managed plugins pin first on the server). */
export function PluginInventorySettingsTab({
  list,
  setEnabled,
  remove,
  update,
  open: openFolder,
  t,
}: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busyId, setBusyId] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(
        entry => matchesFilter(entry, filter) && matches(entry, normalizedQuery),
      )
      : [],
    [filter, normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setActionError(null)
    setRequest(value => value + 1)
  }

  const runManaged = async (
    entryId: PluginInventoryEntry['entryId'],
    action: () => Promise<void>,
    options: { refresh?: boolean } = {},
  ): Promise<void> => {
    setBusyId(entryId)
    setActionError(null)
    try {
      await action()
      setConfirmRemoveId(null)
      if (options.refresh !== false) {
        setState({ status: 'loading' })
        setRequest(value => value + 1)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const filters: { readonly id: CatalogFilter; readonly label: string }[] = [
    { id: 'all', label: t('filterAll') },
    { id: 'custom', label: t('filterCustom') },
    { id: 'disabled', label: t('filterDisabled') },
  ]

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.filterRow} role="toolbar" aria-label={t('catalog')}>
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
              </button>
            ))}
          </div>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {actionError !== null ? <p className={css.actionError} role="alert">{actionError}</p> : null}
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const managed = entry.managed === true
                const needsRestart = entry.needsRestart === true
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                const busy = busyId === entry.entryId
                const confirmRemove = confirmRemoveId === entry.entryId
                const ariaBits = [
                  title,
                  managed ? t('managedTag') : null,
                  configuration,
                  needsRestart ? t('needsRestartTag') : null,
                  entry.version ?? null,
                ].filter(Boolean).join(', ')
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-managed={managed ? 'true' : undefined}
                    data-needs-restart={needsRestart ? 'true' : undefined}
                    data-open={open ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={ariaBits}
                      onClick={() => {
                        setConfirmRemoveId(null)
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                      }}
                    >
                      <span className={css.cardTitleBlock}>
                        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                        {entry.version ? (
                          <span className={css.versionTag} title={t('version')}>{entry.version}</span>
                        ) : null}
                      </span>
                      <span className={css.cardTrailing}>
                        {managed ? (
                          <span className={css.managedTag}>{t('managedTag')}</span>
                        ) : null}
                        {needsRestart ? (
                          <span className={css.restartTag}>{t('needsRestartTag')}</span>
                        ) : null}
                        {entry.enabled ? (
                          <span
                            className={css.statusDot}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            role="img"
                            aria-label={status}
                            title={status}
                          />
                        ) : null}
                        <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                          {configuration}
                        </span>
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.kind ? (
                            <div>
                              <dt>{t('kind')}</dt>
                              <dd>{entry.kind}</dd>
                            </div>
                          ) : null}
                          {entry.version ? (
                            <div>
                              <dt>{t('version')}</dt>
                              <dd>{entry.version}</dd>
                            </div>
                          ) : null}
                          {entry.source ? (
                            <div>
                              <dt>{t('source')}</dt>
                              <dd className={css.sourceValue}>{entry.source}</dd>
                            </div>
                          ) : null}
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                          {needsRestart ? (
                            <div>
                              <dt>{t('needsRestartTag')}</dt>
                              <dd>{t('restartHint')}</dd>
                            </div>
                          ) : null}
                        </dl>
                        {managed ? (
                          <div className={css.actions}>
                            {/* Restart copy lives in the details dl when needsRestart;
                                do not repeat it under every managed card. */}
                            <div className={css.actionRow}>
                              <button
                                type="button"
                                className={css.action}
                                disabled={busy}
                                onClick={() => {
                                  void runManaged(entry.entryId, () => openFolder(entry.entryId), { refresh: false })
                                }}
                              >
                                {busy ? t('actionBusy') : t('edit')}
                              </button>
                              <button
                                type="button"
                                className={css.action}
                                disabled={busy}
                                onClick={() => {
                                  void runManaged(entry.entryId, () => update(entry.entryId))
                                }}
                              >
                                {busy ? t('actionBusy') : t('update')}
                              </button>
                              <button
                                type="button"
                                className={css.action}
                                disabled={busy}
                                onClick={() => {
                                  void runManaged(entry.entryId, () => setEnabled(entry.entryId, !entry.enabled))
                                }}
                              >
                                {entry.enabled ? t('disable') : t('enable')}
                              </button>
                              <button
                                type="button"
                                className={css.actionDanger}
                                disabled={busy}
                                onClick={() => {
                                  if (!confirmRemove) {
                                    setConfirmRemoveId(entry.entryId)
                                    return
                                  }
                                  void runManaged(entry.entryId, () => remove(entry.entryId))
                                }}
                              >
                                {confirmRemove ? t('removeConfirm') : t('remove')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className={css.builtinHint}>{t('builtinHint')}</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
