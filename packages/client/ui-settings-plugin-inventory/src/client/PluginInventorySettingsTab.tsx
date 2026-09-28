import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PluginEntryId, PluginInventorySnapshot } from '@xrkseek/xrk-api-remotes/client'
import {
  Button,
  IconBrowseOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconEllipsisOutline16,
  IconEnhanceOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  Menu,
  Modal,
  StateDot,
  TerminalBlock,
  Toast,
} from '@xrkseek/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Settled CLI mutate log for Settings TerminalBlock (install / update). */
export type PluginInstallLog = {
  readonly command: string
  readonly output: string
  readonly exitCode: number
}

/** npm registry preset for the Manager install row (persisted in localStorage). */
export type InstallRegistryChoice = 'default' | 'npm' | 'npmmirror' | 'custom'

const REGISTRY_STORAGE_KEY = 'xrk.pluginInstall.registry'
const REGISTRY_CUSTOM_STORAGE_KEY = 'xrk.pluginInstall.registryCustom'

const REGISTRY_URLS = {
  npm: 'https://registry.npmjs.org/',
  npmmirror: 'https://registry.npmmirror.com/',
} as const

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
  /** Remount a managed process plugin from disk without reinstalling. */
  reload: (entryId: PluginEntryId) => Promise<void>
  /** Open the managed plugin install folder in the OS. */
  open: (entryId: PluginEntryId) => Promise<void>
  /**
   * Install by CLI-compatible spec (`name`, `name@version`, path, `github:…`).
   * Optional `registry` → `xrkh plugin add --registry`.
   * Optional `requestId` correlates live `plugin-inventory/install-log` chunks.
   */
  install: (spec: string, registry?: string, requestId?: string) => Promise<PluginInstallLog>
  /**
   * Subscribe to live install stdout/stderr for one requestId.
   * Absent in tests that only exercise settled logs.
   */
  subscribeInstallLog?: (
    requestId: string,
    onText: (text: string) => void,
  ) => () => void
}

function readStoredRegistry(): {
  choice: InstallRegistryChoice
  custom: string
} {
  try {
    const raw = globalThis.localStorage?.getItem(REGISTRY_STORAGE_KEY)
    const custom = globalThis.localStorage?.getItem(REGISTRY_CUSTOM_STORAGE_KEY) ?? ''
    if (raw === 'npm' || raw === 'npmmirror' || raw === 'custom' || raw === 'default') {
      return { choice: raw, custom }
    }
    return { choice: 'default', custom }
  } catch {
    return { choice: 'default', custom: '' }
  }
}

function persistRegistry(choice: InstallRegistryChoice, custom: string): void {
  try {
    globalThis.localStorage?.setItem(REGISTRY_STORAGE_KEY, choice)
    globalThis.localStorage?.setItem(REGISTRY_CUSTOM_STORAGE_KEY, custom)
  } catch {
    /* private mode / no storage */
  }
}

/** Resolve the URL passed to Face install, or undefined for npm's configured default. */
function resolveInstallRegistry(
  choice: InstallRegistryChoice,
  custom: string,
): string | undefined {
  if (choice === 'npm') return REGISTRY_URLS.npm
  if (choice === 'npmmirror') return REGISTRY_URLS.npmmirror
  if (choice === 'custom') {
    const url = custom.trim()
    return url.length > 0 ? url : undefined
  }
  return undefined
}

function kindArtwork(
  kind: PluginInventorySnapshot['entries'][number]['kind'] | undefined,
): { readonly Icon: typeof IconBrowseOutline16; readonly labelKey: PluginInventoryLocaleKey } {
  if (kind === 'client') return { Icon: IconBrowseOutline16, labelKey: 'artworkClient' }
  if (kind === 'process') return { Icon: IconSettingsOutline16, labelKey: 'artworkProcess' }
  if (kind === 'both') return { Icon: IconEnhanceOutline16, labelKey: 'artworkBoth' }
  return { Icon: IconEnhanceOutline16, labelKey: 'artworkDefault' }
}

/** Reload the product shell so client halves remount (Desktop chrome or location). */
function refreshClientHalf(): void {
  const bridge = (globalThis as {
    xrkDesktop?: { window?: { reload?: () => Promise<void> } }
  }).xrkDesktop?.window
  if (bridge?.reload !== undefined) {
    void bridge.reload()
    return
  }
  globalThis.location?.reload()
}

function installLogFromError(
  error: unknown,
  spec: string,
  registry?: string,
): PluginInstallLog | null {
  if (error !== null && typeof error === 'object' && 'installLog' in error) {
    const log = (error as { installLog?: unknown }).installLog
    if (
      log !== null &&
      typeof log === 'object' &&
      typeof (log as PluginInstallLog).command === 'string' &&
      typeof (log as PluginInstallLog).output === 'string' &&
      typeof (log as PluginInstallLog).exitCode === 'number'
    ) {
      return log as PluginInstallLog
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      command: registry
        ? `xrkh plugin add --registry ${registry} ${spec}`
        : `xrkh plugin add ${spec}`,
      output: error.message,
      exitCode: 1,
    }
  }
  return null
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type AgentPresetGroup = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type AgentPresetRow = AgentPresetGroup['rows'][number]
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
  // Include the Settings card title (`moduleShortName`) so users can search the
  // label they see, not only the raw npm/module specifier.
  return [
    entry.moduleName,
    moduleShortName(entry.moduleName),
    entry.entryId,
    entry.version,
    entry.kind,
    entry.source,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

function matchesFilter(entry: PluginInventoryEntry, filter: CatalogFilter): boolean {
  if (filter === 'custom') return entry.managed === true
  if (filter === 'disabled') return entry.enabled === false
  return true
}

/** Roster row when the preset switcher has no explicit choice. */
function fallbackPreset(presets: readonly AgentPresetGroup[]): AgentPresetGroup | undefined {
  return presets.find(preset => preset.isDefault) ?? presets[0]
}

/** Switcher label for one agent-preset group. */
function presetLabel(
  preset: AgentPresetGroup,
  t: PluginInventorySettingsTabProps['t'],
): string {
  const name = preset.name ?? preset.id
  if (preset.broken !== undefined) return t('presetOptionBroken', { name })
  if (preset.isDefault) return t('presetOptionDefault', { name })
  return name
}

/** Display title for a composition:* capability row. */
function compositionTitle(moduleName: string): string {
  return moduleName.replace(/^composition:/, '')
}

/** Whether a composition row matches the catalog search. */
function matchesPresetRow(row: AgentPresetRow, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [row.moduleName, compositionTitle(row.moduleName), row.condition]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Configuration tag for a composition row (boolean or conditional). */
function presetEnabledLabel(
  enabled: AgentPresetRow['enabled'],
  t: PluginInventorySettingsTabProps['t'],
): string {
  if (enabled === 'conditional') return t('conditionalTag')
  return t(enabled ? 'enabledTag' : 'disabledTag')
}

/** Render the Host plugin inventory (managed plugins pin first on the server). */
export function PluginInventorySettingsTab({
  list,
  setEnabled,
  remove,
  update,
  reload,
  open: openFolder,
  install,
  subscribeInstallLog,
  t,
}: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toastSeq = useRef(0)
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [chosenPreset, setChosenPreset] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(true)
  const [globalOpen, setGlobalOpen] = useState(true)
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busyId, setBusyId] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PluginInventoryEntry | null>(null)
  const [menuEntryId, setMenuEntryId] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const [installSpec, setInstallSpec] = useState('')
  const [installBusy, setInstallBusy] = useState(false)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installSuccess, setInstallSuccess] = useState(false)
  const [clientRefreshHint, setClientRefreshHint] = useState(false)
  const [installLog, setInstallLog] = useState<PluginInstallLog | null>(null)
  const storedRegistry = useMemo(() => readStoredRegistry(), [])
  const [registryChoice, setRegistryChoice] = useState<InstallRegistryChoice>(storedRegistry.choice)
  const [registryCustom, setRegistryCustom] = useState(storedRegistry.custom)

  const installExamples = [
    {
      title: t('installGuidePackageTitle'),
      example: t('installGuidePackageExample'),
      hint: t('installGuidePackageHint'),
    },
    {
      title: t('installGuideGitTitle'),
      example: t('installGuideGitExample'),
      hint: t('installGuideGitHint'),
    },
    {
      title: t('installGuidePathTitle'),
      example: t('installGuidePathExample'),
      hint: t('installGuidePathHint'),
    },
  ] as const

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const presets = state.status === 'ready' ? (state.snapshot.agentPresets ?? []) : []
  const selectedPreset = presets.find(preset => preset.id === chosenPreset) ?? fallbackPreset(presets)
  const selectedPresetRows = useMemo(
    () => (selectedPreset?.rows ?? []).filter(row => matchesPresetRow(row, normalizedQuery)),
    [normalizedQuery, selectedPreset],
  )
  const otherPresetMatches = useMemo(
    () => presets.filter(preset =>
      preset.id !== selectedPreset?.id
      && preset.rows.some(row => matchesPresetRow(row, normalizedQuery)),
    ),
    [normalizedQuery, presets, selectedPreset],
  )
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

  useEffect(() => {
    if (state.status !== 'ready') return
    if (state.snapshot.entries.some(entry => entry.needsRestart === true)) {
      setClientRefreshHint(true)
    }
  }, [state])

  const retry = (): void => {
    setState({ status: 'loading' })
    setActionError(null)
    setRequest(value => value + 1)
  }

  const showToast = (text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }

  const runManaged = async (
    entryId: PluginInventoryEntry['entryId'],
    action: () => Promise<void>,
    options: { refresh?: boolean; notice?: string; clientRefresh?: boolean } = {},
  ): Promise<void> => {
    setBusyId(entryId)
    setActionError(null)
    try {
      await action()
      setRemoveTarget(null)
      setMenuEntryId(null)
      if (options.notice !== undefined) showToast(options.notice)
      if (options.clientRefresh === true) setClientRefreshHint(true)
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

  const closeRemove = (): void => {
    if (busyId !== null && removeTarget !== null && busyId === removeTarget.entryId) return
    setRemoveTarget(null)
  }

  const confirmRemove = (): void => {
    if (removeTarget === null) return
    const name = moduleShortName(removeTarget.moduleName)
    void runManaged(
      removeTarget.entryId,
      () => remove(removeTarget.entryId),
      { notice: t('toastRemoved', { name }) },
    )
  }

  const runInstall = async (): Promise<void> => {
    const spec = installSpec.trim()
    if (!spec || installBusy) return
    if (registryChoice === 'custom' && registryCustom.trim().length === 0) {
      setInstallError(t('registryCustomRequired'))
      return
    }
    const registry = resolveInstallRegistry(registryChoice, registryCustom)
    persistRegistry(registryChoice, registryCustom)
    const command = registry
      ? `xrkh plugin add --registry ${registry} ${spec}`
      : `xrkh plugin add ${spec}`
    const requestId = `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setInstallBusy(true)
    setInstallError(null)
    setInstallSuccess(false)
    setInstallLog({
      command,
      output: '',
      exitCode: 0,
    })
    const unsub = subscribeInstallLog?.(requestId, (text) => {
      setInstallLog((prev) => (
        prev === null
          ? { command, output: text, exitCode: 0 }
          : { ...prev, output: prev.output + text }
      ))
    })
    try {
      const log = registry !== undefined
        ? await install(spec, registry, requestId)
        : await install(spec, undefined, requestId)
      setInstallLog(log)
      setInstallSpec('')
      setInstallSuccess(true)
      setClientRefreshHint(true)
      showToast(t('toastInstalled', { name: spec }))
      setState({ status: 'loading' })
      setRequest(value => value + 1)
    } catch (error) {
      setInstallLog((prev) => {
        const fromError = installLogFromError(error, spec, registry)
        if (fromError === null) return prev
        // Keep streamed body when the error payload has no richer log.
        if (prev !== null && prev.output.length > 0 && fromError.output.length <= prev.output.length) {
          return { ...fromError, output: prev.output, exitCode: 1 }
        }
        return fromError
      })
      setInstallError(error instanceof Error ? error.message : t('actionFailed'))
    } finally {
      unsub?.()
      setInstallBusy(false)
    }
  }

  const filters: { readonly id: CatalogFilter; readonly label: string }[] = [
    { id: 'all', label: t('filterAll') },
    { id: 'custom', label: t('filterCustom') },
    { id: 'disabled', label: t('filterDisabled') },
  ]

  return (
    <div ref={rootRef} className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <form
            className={css.installRow}
            onSubmit={(event) => {
              event.preventDefault()
              void runInstall()
            }}
          >
            <label className={css.installField}>
              <span className={css.visuallyHidden}>{t('installPlaceholder')}</span>
              <input
                type="text"
                value={installSpec}
                placeholder={t('installPlaceholder')}
                aria-label={t('installPlaceholder')}
                disabled={installBusy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setInstallSpec(event.currentTarget.value)
                  setInstallError(null)
                  setInstallSuccess(false)
                  setInstallLog(null)
                }}
              />
            </label>
            <button
              type="submit"
              className={css.installButton}
              disabled={installBusy || installSpec.trim().length === 0}
            >
              {installBusy ? t('actionBusy') : t('install')}
            </button>
          </form>
          <div className={css.registryRow}>
            <label className={css.registryField}>
              <span className={css.registryLabel}>{t('registryLabel')}</span>
              <select
                className={css.registrySelect}
                value={registryChoice}
                disabled={installBusy}
                aria-label={t('registryLabel')}
                onChange={(event) => {
                  const next = event.currentTarget.value as InstallRegistryChoice
                  setRegistryChoice(next)
                  persistRegistry(next, registryCustom)
                }}
              >
                <option value="default">{t('registryDefault')}</option>
                <option value="npm">{t('registryNpm')}</option>
                <option value="npmmirror">{t('registryNpmmirror')}</option>
                <option value="custom">{t('registryCustom')}</option>
              </select>
            </label>
            {registryChoice === 'custom'
              ? (
                <label className={css.registryCustomField}>
                  <span className={css.visuallyHidden}>{t('registryCustomPlaceholder')}</span>
                  <input
                    type="url"
                    value={registryCustom}
                    placeholder={t('registryCustomPlaceholder')}
                    aria-label={t('registryCustomPlaceholder')}
                    disabled={installBusy}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      const next = event.currentTarget.value
                      setRegistryCustom(next)
                      persistRegistry('custom', next)
                    }}
                  />
                </label>
              )
              : null}
          </div>
          <p className={css.installHint}>{t('installHint')}</p>
          <button
            type="button"
            className={css.guideToggle}
            aria-expanded={installGuideOpen}
            onClick={() => { setInstallGuideOpen((open) => !open) }}
          >
            <IconChevronDownOutline14
              className={installGuideOpen ? css.guideChevronOpen : css.guideChevron}
            />
            {t(installGuideOpen ? 'installGuideHide' : 'installGuideShow')}
          </button>
          {installGuideOpen
            ? (
              <div className={css.installGuide}>
                <ol className={css.guideList}>
                  {installExamples.map((item) => (
                    <li key={item.example} className={css.guideItem}>
                      <div className={css.guideCopy}>
                        <strong>{item.title}</strong>
                        <code className={css.guideExample}>{item.example}</code>
                        <span className={css.guideHint}>{item.hint}</span>
                      </div>
                      <button
                        type="button"
                        className={css.guideFill}
                        aria-label={t('installGuideFillAria', { example: item.example })}
                        onClick={() => {
                          setInstallSpec(item.example)
                          setInstallError(null)
                          setInstallSuccess(false)
                          setInstallLog(null)
                        }}
                      >
                        {t('installGuideFill')}
                      </button>
                    </li>
                  ))}
                </ol>
                <p className={css.guideSafety} role="note">{t('installGuideSafety')}</p>
              </div>
            )
            : null}
          {installError !== null
            ? (
              <div className={css.installError} role="alert">
                <p>{installError}</p>
                <p className={css.installErrorHint}>{t('installErrorHint')}</p>
              </div>
            )
            : null}
          {installSuccess || clientRefreshHint
            ? (
              <div className={css.installSuccessRow} role="status" data-client-refresh-hint>
                <p className={css.installSuccess}>
                  {installSuccess ? t('installSuccessHint') : t('clientRefreshHint')}
                </p>
                <button type="button" className={css.refreshPage} onClick={refreshClientHalf}>
                  {t('refreshPage')}
                </button>
              </div>
            )
            : null}
          {installLog !== null || installBusy
            ? (
              <div className={css.installLog} data-install-log>
                <TerminalBlock
                  command={installLog?.command ?? `xrkh plugin add ${installSpec.trim()}`}
                  output={installLog?.output ?? ''}
                  exitCode={installBusy ? undefined : installLog?.exitCode}
                  running={installBusy}
                  labels={{
                    running: t('installLogRunning'),
                    copy: t('installLogCopy'),
                    copied: t('installLogCopied'),
                    collapse: t('installLogCollapse'),
                    expand: (hidden) => t('installLogExpand', { count: String(hidden) }),
                  }}
                />
              </div>
            )
            : null}
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
          {(() => {
            const failedNames = state.snapshot.entries
              .filter((entry) => entry.enabled && entry.fiberPhase === 'failed')
              .map((entry) => moduleShortName(entry.moduleName))
            return failedNames.length > 0
              ? (
                <div className={css.clientSync} role="status" data-client-sync="failed">
                  <div className={css.clientSyncRow}>
                    <StateDot state="error" />
                    <span>{t('clientSyncFailed', { names: failedNames.join(', ') })}</span>
                  </div>
                  <div className={css.clientSyncActions}>
                    <button type="button" className={css.clientSyncRetry} onClick={retry}>
                      {t('clientSyncRetry')}
                    </button>
                    <button type="button" className={css.clientSyncRetry} onClick={refreshClientHalf}>
                      {t('refreshPage')}
                    </button>
                  </div>
                </div>
              )
              : null
          })()}
          {actionError !== null ? <p className={css.actionError} role="alert">{actionError}</p> : null}

          {selectedPreset !== undefined ? (
            <section className={css.scopeGroup} data-plugin-scope="preset" data-preset-id={selectedPreset.id}>
              <div className={css.scopeTitleRow}>
                <button
                  type="button"
                  className={css.scopeToggle}
                  aria-expanded={presetOpen}
                  aria-controls={`${catalogId}-preset`}
                  onClick={() => { setPresetOpen(value => !value) }}
                >
                  <IconChevronDownOutline14 className={css.scopeChevron} data-open={presetOpen || undefined} aria-hidden="true" />
                  <span className={css.scopeTitle}>{t('presetTitle')}</span>
                </button>
                <Menu
                  open={switcherOpen}
                  onClose={() => { setSwitcherOpen(false) }}
                  items={presets.map(preset => ({
                    id: preset.id,
                    label: presetLabel(preset, t),
                  }))}
                  selectedId={selectedPreset.id}
                  onSelect={(id) => {
                    setSwitcherOpen(false)
                    setChosenPreset(id)
                  }}
                  align="end"
                  portal
                  anchor={(
                    <button
                      type="button"
                      className={css.presetSwitcher}
                      aria-haspopup="menu"
                      aria-expanded={switcherOpen}
                      aria-label={t('switcherLabel')}
                      onClick={() => { setSwitcherOpen(value => !value) }}
                    >
                      <span>{presetLabel(selectedPreset, t)}</span>
                      <IconChevronDownOutline14 aria-hidden="true" />
                    </button>
                  )}
                />
              </div>
              <p className={css.scopeSub}>
                {t('presetSubtitle')}
                <span data-preset-plugin-count={selectedPresetRows.length}>
                  {` · ${String(selectedPresetRows.length)} ${t('countUnit')}`}
                </span>
              </p>
              {presetOpen ? (
                <div id={`${catalogId}-preset`} className={css.scopeBody}>
                  {selectedPreset.broken !== undefined
                    ? <p className={css.brokenNote} role="alert">{selectedPreset.broken}</p>
                    : null}
                  {selectedPresetRows.length > 0 ? (
                    <ul className={css.cards} data-preset-rows>
                      {selectedPresetRows.map((row) => {
                        const title = compositionTitle(row.moduleName)
                        const configuration = presetEnabledLabel(row.enabled, t)
                        return (
                          <li
                            className={css.card}
                            key={`${selectedPreset.id}:${row.moduleName}`}
                            data-composition={row.moduleName}
                            data-enabled={String(row.enabled)}
                          >
                            <div className={css.cardContent} data-static="true">
                              <span className={css.artwork} data-kind="composition" aria-hidden="true">
                                <IconEnhanceOutline16 size={16} />
                              </span>
                              <span className={css.cardTitleBlock}>
                                <span className={css.cardTitleRow}>
                                  <strong className={css.cardTitle}>{title}</strong>
                                  {row.condition !== undefined
                                    ? <span className={css.versionTag}>{row.condition}</span>
                                    : null}
                                </span>
                              </span>
                              <span className={css.cardTrailing}>
                                <StateDot
                                  state={row.enabled === false ? 'error' : row.enabled === 'conditional' ? 'warning' : 'done'}
                                />
                                <span className={css.configTag} data-enabled={row.enabled === false ? 'false' : 'true'}>
                                  {configuration}
                                </span>
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                  {normalizedQuery.length > 0 && otherPresetMatches.length > 0 ? (
                    <p className={css.hint}>
                      {t('matchesInOtherPresets', { count: String(otherPresetMatches.length) })}
                      {otherPresetMatches.map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          className={css.jumpLink}
                          onClick={() => { setChosenPreset(preset.id) }}
                        >
                          {preset.name ?? preset.id}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={css.scopeGroup} data-plugin-scope="global">
            <div className={css.scopeTitleRow}>
              <button
                type="button"
                className={css.scopeToggle}
                aria-expanded={globalOpen}
                aria-controls={`${catalogId}-global`}
                onClick={() => { setGlobalOpen(value => !value) }}
              >
                <IconChevronDownOutline14 className={css.scopeChevron} data-open={globalOpen || undefined} aria-hidden="true" />
                <span className={css.scopeTitle}>{t('globalTitle')}</span>
              </button>
              <span className={css.scopeCount} data-plugin-count={filteredEntries.length}>
                {filteredEntries.length}
              </span>
            </div>
            <p className={css.scopeSub}>{t('globalSubtitle')}</p>
            {globalOpen ? (
              <div id={`${catalogId}-global`} className={css.scopeBody}>
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {(() => {
                const managedRows = filteredEntries.filter((entry) => entry.managed === true)
                const builtinRows = filteredEntries.filter((entry) => entry.managed !== true)
                const showGroups = filter === 'all' && managedRows.length > 0 && builtinRows.length > 0
                const sections: { readonly label: string | null; readonly rows: typeof filteredEntries }[] = showGroups
                  ? [
                    { label: t('groupInstalled'), rows: managedRows },
                    { label: t('groupBuiltin'), rows: builtinRows },
                  ]
                  : [{ label: null, rows: filteredEntries }]
                return sections.flatMap((section) => [
                  ...(section.label !== null
                    ? [(
                      <li key={`section:${section.label}`} className={css.groupHeading} role="presentation">
                        {section.label}
                      </li>
                    )]
                    : []),
                  ...section.rows.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const managed = entry.managed === true
                const needsRestart = entry.needsRestart === true
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                const busy = busyId === entry.entryId
                const art = kindArtwork(entry.kind)
                const ArtworkIcon = art.Icon
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
                    data-kind={entry.kind ?? 'unknown'}
                  >
                    <div className={css.cardHead}>
                      <button
                        className={css.cardContent}
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-label={ariaBits}
                        onClick={() => {
                          setRemoveTarget(null)
                          setMenuEntryId(null)
                          setExpanded(current => current === entry.entryId ? null : entry.entryId)
                        }}
                      >
                        <span
                          className={css.artwork}
                          data-kind={entry.kind ?? 'unknown'}
                          aria-hidden
                          title={t(art.labelKey)}
                        >
                          <ArtworkIcon size={18} />
                        </span>
                        <span className={css.cardTitleBlock}>
                          <span className={css.cardTitleRow}>
                            <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                            {entry.version ? (
                              <span className={css.versionTag} title={t('version')}>{entry.version}</span>
                            ) : null}
                          </span>
                          {managed || needsRestart ? (
                            <span className={css.cardMetaRow}>
                              {managed ? (
                                <span className={css.managedTag}>{t('managedTag')}</span>
                              ) : null}
                              {needsRestart ? (
                                <span className={css.restartTag}>{t('needsRestartTag')}</span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <span className={css.cardTrailing}>
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
                      {managed ? (
                        <div className={css.moreSlot}>
                          <Menu
                            open={menuEntryId === entry.entryId}
                            portal
                            dense
                            compact
                            align="end"
                            onClose={() => { setMenuEntryId(null) }}
                            anchor={(
                              <button
                                type="button"
                                className={css.moreTrigger}
                                aria-haspopup="menu"
                                aria-expanded={menuEntryId === entry.entryId}
                                aria-label={t('moreActions', { name: title })}
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setRemoveTarget(null)
                                  setMenuEntryId(current => (
                                    current === entry.entryId ? null : entry.entryId
                                  ))
                                }}
                              >
                                <IconEllipsisOutline16 size={14} />
                              </button>
                            )}
                            items={[
                              { id: 'edit', label: t('edit'), disabled: busy },
                              { id: 'reload', label: t('reload'), disabled: busy },
                              { id: 'update', label: t('update'), disabled: busy },
                              {
                                id: 'toggle',
                                label: entry.enabled ? t('disable') : t('enable'),
                                disabled: busy,
                              },
                              { type: 'separator', id: 'remove-sep' },
                              { id: 'remove', label: t('remove'), danger: true, disabled: busy },
                            ]}
                            onSelect={(id) => {
                              setMenuEntryId(null)
                              const name = title
                              if (id === 'edit') {
                                void runManaged(entry.entryId, () => openFolder(entry.entryId), { refresh: false })
                                return
                              }
                            if (id === 'reload') {
                              void runManaged(
                                entry.entryId,
                                () => reload(entry.entryId),
                                { notice: t('toastReloaded', { name }), clientRefresh: true },
                              )
                              return
                            }
                            if (id === 'update') {
                              void runManaged(
                                entry.entryId,
                                () => update(entry.entryId),
                                { notice: t('toastUpdated', { name }), clientRefresh: true },
                              )
                              return
                            }
                            if (id === 'toggle') {
                              const next = !entry.enabled
                              void runManaged(
                                entry.entryId,
                                () => setEnabled(entry.entryId, next),
                                {
                                  notice: t(next ? 'toastEnabled' : 'toastDisabled', { name }),
                                  clientRefresh: true,
                                },
                              )
                              return
                            }
                              if (id === 'remove') setRemoveTarget(entry)
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
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
                              <dd>
                                <span>{t('restartHint')}</span>
                                {' '}
                                <button
                                  type="button"
                                  className={css.refreshPage}
                                  onClick={refreshClientHalf}
                                >
                                  {t('refreshPage')}
                                </button>
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {managed ? null : (
                          <p className={css.builtinHint}>{t('builtinHint')}</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
                  }),
                ])
              })()}
            </ul>
          ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
      <Modal
        open={removeTarget !== null}
        onClose={closeRemove}
        title={removeTarget === null
          ? ''
          : t('removeTitle', { name: moduleShortName(removeTarget.moduleName) })}
        closeLabel={t('close')}
        description={removeTarget === null ? '' : t('removeDescription')}
        className={css.removeDialog}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={busyId !== null} onClick={closeRemove}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.removeConfirm}
              disabled={busyId !== null}
              onClick={confirmRemove}
            >
              {busyId !== null && removeTarget !== null && busyId === removeTarget.entryId
                ? t('actionBusy')
                : t('removeConfirm')}
            </Button>
          </>
        )}
      />
      {toast !== null
        ? (
          <Toast
            key={toast.seq}
            text={toast.text}
            icon={<IconCheckOutline16 size={14} />}
            anchor={rootRef.current}
            onDone={() => { setToast(null) }}
          />
        )
        : null}
    </div>
  )
}
