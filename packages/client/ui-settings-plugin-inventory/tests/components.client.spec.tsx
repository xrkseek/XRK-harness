// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginInventorySettingsTab,
  resetPluginInventoryCacheForTests,
} from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'
import { resetPluginInstallUiSessionForTests } from '../src/client/plugin-install-ui-session.ts'

afterEach(() => {
  cleanup()
  resetPluginInstallUiSessionForTests()
  resetPluginInventoryCacheForTests()
  try {
    globalThis.localStorage?.removeItem('xrk.pluginInstall.registry')
    globalThis.localStorage?.removeItem('xrk.pluginInstall.registryCustom')
    globalThis.localStorage?.removeItem('xrk.pluginInstall.proxy')
  } catch {
    /* jsdom / private mode */
  }
})

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, string>): string => {
  let text = en[key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, value)
    }
  }
  return text
}) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  overrides: Partial<PluginInventorySettingsTabInjected> = {},
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    setEnabled: overrides.setEnabled ?? vi.fn(async () => {}),
    remove: overrides.remove ?? vi.fn(async () => {}),
    update: overrides.update ?? vi.fn(async () => {}),
    reload: overrides.reload ?? vi.fn(async () => {}),
    open: overrides.open ?? vi.fn(async () => {}),
    install: overrides.install ?? vi.fn(async () => ({
      command: 'xrkh plugin add fixture',
      output: '',
      exitCode: 0,
    })),
    ...(overrides.subscribeInstallLog !== undefined
      ? { subscribeInstallLog: overrides.subscribeInstallLog }
      : {}),
    ...(overrides.subscribeUpdatesChanged !== undefined
      ? { subscribeUpdatesChanged: overrides.subscribeUpdatesChanged }
      : {}),
    ...(overrides.checkUpdates !== undefined
      ? { checkUpdates: overrides.checkUpdates }
      : {}),
  } as PluginInventorySettingsTabProps
}

const PRESET_ROWS_MINIMAL = [
  { entryId: null, moduleName: 'composition:base', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:harness-tools', enabled: false, fiberPhase: null },
  { entryId: null, moduleName: 'composition:web', enabled: false, fiberPhase: null },
  { entryId: null, moduleName: 'composition:lsp', enabled: false, fiberPhase: null },
  { entryId: null, moduleName: 'composition:pty', enabled: false, fiberPhase: null },
  { entryId: null, moduleName: 'composition:subagents', enabled: false, fiberPhase: null },
] as const

const PRESET_ROWS_HARNESS = [
  { entryId: null, moduleName: 'composition:base', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:harness-tools', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:web', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:lsp', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:pty', enabled: true, fiberPhase: 'active' },
  { entryId: null, moduleName: 'composition:subagents', enabled: true, fiberPhase: 'active' },
] as const

const SNAPSHOT = {
  entries: [
    { entryId: 'xrkh-better-sidebar', moduleName: 'xrkh-better-sidebar', enabled: true, fiberPhase: 'active', managed: true, version: '0.18.2', kind: 'client', source: 'xrkh-better-sidebar@0.18.2' },
    { entryId: '8a1b2c3d', moduleName: '@xrkseek/cordis-plugin-hmr', enabled: true, fiberPhase: 'active', managed: false },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending', managed: false },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading', managed: false },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed', managed: false },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading', managed: false },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null, managed: false },
    { entryId: 'disabled-entry', moduleName: '@xrkseek/xrk-host-directory-picker-native', enabled: false, fiberPhase: null, managed: false },
    { entryId: 'pending-restart', moduleName: 'pending-restart', enabled: true, fiberPhase: null, managed: true, version: '1.0.0', kind: 'client', needsRestart: true },
  ],
  agentPresets: [
    { id: 'minimal', name: 'Minimal', isDefault: true, rows: PRESET_ROWS_MINIMAL },
    { id: 'harness', name: 'XRK Harness', isDefault: false, rows: PRESET_ROWS_HARNESS },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('exposes a clickable git-worktrees switch for main-session / subagent collaboration', async () => {
    const setEnabled = vi.fn(async () => {})
    const snapshot = {
      ...SNAPSHOT,
      entries: [
        {
          entryId: 'git-worktrees',
          moduleName: 'git-worktrees',
          enabled: false,
          fiberPhase: null,
          managed: true,
          kind: 'process',
        },
        ...SNAPSHOT.entries,
      ],
    } as unknown as Snapshot
    render(<PluginInventorySettingsTab {...props(async () => snapshot, { setEnabled })} />)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: en.gitWorktreesSwitch })).toBeTruthy()
    })
    expect(screen.getByText(en.gitWorktreesTitle)).toBeTruthy()
    expect(screen.getByText(en.gitWorktreesHint)).toBeTruthy()
    const sw = screen.getByRole('switch', { name: en.gitWorktreesSwitch })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith('git-worktrees', true)
    })
  })

  it('renders runtime status only for enabled plugins and pins custom actions', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const setEnabled = vi.fn(async () => {})
    const remove = vi.fn(async () => {})
    const update = vi.fn(async () => ({
      command: 'xrkh plugin add xrkh-better-sidebar@latest',
      output: '',
      exitCode: 0,
    }))
    const open = vi.fn(async () => {})
    const view = render(<PluginInventorySettingsTab {...props(list, { setEnabled, remove, update, open })} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-scope="preset"]')).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-scope="global"]')).toBeTruthy()
    expect(screen.getByText(en.presetTitle)).toBeTruthy()
    expect(screen.getByText(en.globalTitle)).toBeTruthy()
    // Custom / global inventory sits above session composition for scan density.
    const globalEl = view.container.querySelector('[data-plugin-scope="global"]')!
    const presetEl = view.container.querySelector('[data-plugin-scope="preset"]')!
    expect(
      Boolean(globalEl.compareDocumentPosition(presetEl) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('9')
    // 6 composition rows (default minimal) + 2 group headings + 9 global cards
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(15)
    expect(screen.getAllByText(en.managedTag).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('0.18.2')).toBeTruthy()
    expect(screen.getAllByText(en.needsRestartTag).length).toBeGreaterThanOrEqual(1)
    // Builtin / composition still show Enabled tags; managed uses a Switch.
    expect(screen.getAllByText(en.enabledTag).length).toBeGreaterThanOrEqual(6)
    expect(screen.getAllByText(en.disabledTag).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('switch', { name: 'better-sidebar' })).toBeTruthy()

    const managed = screen.getByRole('button', { name: 'better-sidebar, Custom, Enabled, 0.18.2' })
    // Managed actions live on the card head — no expand required to open the menu.
    const openManagedMenu = async (): Promise<void> => {
      fireEvent.click(await screen.findByRole('button', {
        name: en.moreActions.replace('{name}', 'better-sidebar'),
      }))
    }

    await openManagedMenu()
    expect(screen.getByRole('menuitem', { name: en.edit })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: en.update })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: en.disable })).toBeNull()
    expect(screen.getByRole('menuitem', { name: en.remove })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: en.update }))
    await waitFor(() => {
      // registry/proxy follow Settings install-row (default → undefined).
      expect(update).toHaveBeenCalledWith(
        'xrkh-better-sidebar',
        expect.any(String),
        undefined,
        undefined,
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.toastUpdated.replace('{name}', 'better-sidebar'))
    })

    fireEvent.click(screen.getByRole('switch', { name: 'better-sidebar' }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('xrkh-better-sidebar', false) })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.toastDisabled.replace('{name}', 'better-sidebar'))
    })

    // Details expand still works after head-menu actions (before remove).
    fireEvent.click(screen.getByRole('button', { name: 'better-sidebar, Custom, Enabled, 0.18.2' }))
    expect(screen.getByText(en.kind)).toBeTruthy()
    expect(screen.getByText('client')).toBeTruthy()
    expect(screen.getByText(en.source)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'better-sidebar, Custom, Enabled, 0.18.2' }))

    await openManagedMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: en.remove }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(en.removeTitle.replace('{name}', 'better-sidebar'))
    expect(dialog.textContent).toContain(en.removeDescription)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    // Modal keeps the dialog mounted through its closing phase.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(remove).not.toHaveBeenCalled()

    await openManagedMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: en.remove }))
    fireEvent.click(screen.getByRole('button', { name: en.removeConfirm }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('xrkh-better-sidebar') })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.toastRemoved.replace('{name}', 'better-sidebar'))
    })
    await waitFor(() => {
      const hint = view.container.querySelector('[data-client-refresh-hint]')
      expect(hint).toBeTruthy()
      // Update leaves installSuccess; later toggles/remove keep the refresh row.
      const hintText = hint!.textContent ?? ''
      expect(
        hintText.includes(en.clientRefreshHint) || hintText.includes(en.installSuccessHint),
      ).toBe(true)
      // Failed-fiber banner also exposes refresh — assert the hint row's button.
      expect(hint!.querySelector('button')?.textContent).toBe(en.refreshPage)
    })

    const globalEntries = (): number =>
      view.container.querySelectorAll('[data-plugin-scope="global"] [data-plugin-entry]').length
    fireEvent.click(screen.getByRole('button', { name: en.filterCustom }))
    expect(globalEntries()).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: en.filterDisabled }))
    expect(globalEntries()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: en.filterAll }))
    expect(globalEntries()).toBe(9)

    const hmrCard = view.container.querySelector('[data-plugin-entry="8a1b2c3d"]')
    expect(hmrCard).toBeTruthy()
    const active = hmrCard!.querySelector('button')!
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.builtinHint)).toBeTruthy()
    expect(screen.queryByRole('button', {
      name: en.moreActions.replace('{name}', 'hmr'),
    })).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('host-directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: '0.18.2' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('better-sidebar')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    // Visible card title (`hmr` from cordis-plugin-hmr) is searchable.
    fireEvent.change(search, { target: { value: 'hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('switches session composition presets from the Menu', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    await screen.findByText(en.presetTitle)
    expect(screen.getByLabelText(en.switcherLabel).textContent).toContain('Minimal')
    expect(document.querySelector('[data-composition="composition:web"]')?.getAttribute('data-enabled'))
      .toBe('false')
    fireEvent.click(screen.getByLabelText(en.switcherLabel))
    fireEvent.click(screen.getByRole('menuitem', { name: 'XRK Harness' }))
    expect(screen.getByLabelText(en.switcherLabel).textContent).toContain('XRK Harness')
    expect(document.querySelector('[data-composition="composition:web"]')?.getAttribute('data-enabled'))
      .toBe('true')
  })

  it('surfaces a client-mount failure banner when any enabled fiber is failed', async () => {
    const reload = vi.fn()
    const previous = globalThis.location
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { ...previous, reload },
    })
    try {
      render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
      await screen.findByText(en.globalTitle)
      const banner = document.querySelector('[data-client-sync="failed"]')
      expect(banner).toBeTruthy()
      expect(banner!.textContent).toContain(en.clientSyncFailed.replace('{names}', 'failed-name'))
      expect(banner!.textContent).toContain('failed-name')
      expect(screen.getByRole('button', { name: en.clientSyncRetry })).toBeTruthy()
      // Refresh affordance: failure banner + needsRestart hint both expose it.
      const refreshButtons = screen.getAllByRole('button', { name: en.refreshPage })
      expect(refreshButtons.length).toBeGreaterThanOrEqual(1)
      fireEvent.click(refreshButtons[0]!)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: previous })
    }
  })

  it('keeps live install log under the proxy when the sidebar package is still missing', async () => {
    const deferred = Promise.withResolvers<{
      command: string
      output: string
      exitCode: number
    }>()
    const install = vi.fn(async () => deferred.promise)
    const snap = {
      ...SNAPSHOT,
      entries: SNAPSHOT.entries.filter((entry) => entry.entryId !== 'xrkh-better-sidebar'),
    }
    const { container } = render(
      <PluginInventorySettingsTab {...props(async () => snap, { install })} />,
    )
    await screen.findByText(en.globalTitle)
    expect(container.querySelector('[data-plugin-recommend="xrkh-better-sidebar"]')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(en.installPlaceholder), {
      target: { value: 'dsh-whale-girl' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitFor(() => {
      expect(container.querySelector('[data-install-log]')).toBeTruthy()
    })

    const proxyLabel = screen.getByText(en.installProxyLabel)
    const log = container.querySelector('[data-install-log]')!
    const recommend = container.querySelector('[data-plugin-recommend="xrkh-better-sidebar"]')!
    expect(
      Boolean(proxyLabel.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    expect(
      Boolean(log.compareDocumentPosition(recommend) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)

    deferred.resolve({
      command: 'xrkh plugin add dsh-whale-girl',
      output: 'ok\n',
      exitCode: 0,
    })
    await waitFor(() => {
      expect(container.querySelector('[data-client-refresh-hint]')).toBeTruthy()
    })
    const refreshHint = container.querySelector('[data-client-refresh-hint]')!
    expect(
      Boolean(proxyLabel.compareDocumentPosition(refreshHint) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    expect(
      Boolean(refreshHint.compareDocumentPosition(recommend) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })

  it('rotates scope disclosure from aria-expanded on the toggle (not dropped Icon data-open)', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    await screen.findByText(en.globalTitle)
    const globalToggle = screen.getByRole('button', { name: en.globalTitle })
    expect(globalToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(globalToggle)
    expect(globalToggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(globalToggle)
    expect(globalToggle.getAttribute('aria-expanded')).toBe('true')

    const presetToggle = screen.getByRole('button', { name: en.presetTitle })
    expect(presetToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(presetToggle)
    expect(presetToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('fills install examples from the guide and surfaces install errors under the form', async () => {
    const install = vi.fn(async () => { throw new Error('npm pack failed') })
    const { container } = render(
      <PluginInventorySettingsTab {...props(async () => SNAPSHOT, { install })} />,
    )
    await screen.findByText(en.globalTitle)

    fireEvent.click(screen.getByRole('button', { name: en.installGuideShow }))
    expect(screen.getByText(en.installGuidePackageExample)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {
      name: en.installGuideFillAria.replace('{example}', en.installGuidePackageExample),
    }))
    expect((screen.getByLabelText(en.installPlaceholder) as HTMLInputElement).value)
      .toBe(en.installGuidePackageExample)

    fireEvent.change(screen.getByLabelText(en.registryLabel), { target: { value: 'npmmirror' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith(
        en.installGuidePackageExample,
        'https://registry.npmmirror.com/',
        expect.stringMatching(/^install-/),
        undefined,
      )
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('npm pack failed')
    expect(alert.textContent).toContain(en.installErrorHint)
    await waitFor(() => {
      expect(container.querySelector('[data-install-log]')).toBeTruthy()
    })
    expect(container.textContent).toContain(
      `xrkh plugin add --registry https://registry.npmmirror.com/ ${en.installGuidePackageExample}`,
    )
    expect(container.querySelector('[data-kind="client"]')).toBeTruthy()
  })

  it('keeps install TerminalBlock and refresh hint after Settings remount', async () => {
    const deferred = Promise.withResolvers<{
      command: string
      output: string
      exitCode: number
    }>()
    let pushLog: ((text: string) => void) | undefined
    const install = vi.fn(async (_spec: string, _reg?: string, requestId?: string) => {
      void requestId
      return deferred.promise
    })
    const subscribeInstallLog = vi.fn((requestId: string, onText: (text: string) => void) => {
      expect(requestId).toMatch(/^install-/)
      pushLog = onText
      return () => { pushLog = undefined }
    })
    // No needsRestart rows — refresh hint must come from the install session.
    const snap = {
      ...SNAPSHOT,
      entries: SNAPSHOT.entries.filter((entry) => entry.needsRestart !== true),
    }

    const first = render(
      <PluginInventorySettingsTab
        {...props(async () => snap, { install, subscribeInstallLog })}
      />,
    )
    await screen.findByText(en.globalTitle)
    fireEvent.change(screen.getByLabelText(en.installPlaceholder), {
      target: { value: '@remount/pkg' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitFor(() => {
      expect(first.container.querySelector('[data-install-log]')).toBeTruthy()
    })
    expect(subscribeInstallLog).toHaveBeenCalled()
    act(() => { pushLog?.('fetching\n') })
    expect(first.container.textContent).toContain('fetching')
    first.unmount()

    const second = render(
      <PluginInventorySettingsTab
        {...props(async () => snap, { install, subscribeInstallLog })}
      />,
    )
    await screen.findByText(en.globalTitle)
    expect(second.container.querySelector('[data-install-log]')).toBeTruthy()
    expect(second.container.textContent).toContain('fetching')
    expect(second.container.textContent).toContain(en.installLogRunning)

    deferred.resolve({
      command: 'xrkh plugin add @remount/pkg',
      output: 'fetching\nok\n',
      exitCode: 0,
    })
    await waitFor(() => {
      expect(second.container.querySelector('[data-client-refresh-hint]')).toBeTruthy()
    })
    expect(second.container.textContent).toContain(en.installSuccessHint)
    second.unmount()

    const third = render(
      <PluginInventorySettingsTab {...props(async () => snap, { install })} />,
    )
    await screen.findByText(en.globalTitle)
    expect(third.container.querySelector('[data-client-refresh-hint]')).toBeTruthy()
    expect(third.container.querySelector('[data-install-log]')).toBeTruthy()
    expect(third.container.textContent).toContain('fetching')
  })

  it('collapses phone-guest engine rows into one read-only runtime card', async () => {
    const snap = {
      ...SNAPSHOT,
      entries: [
        ...SNAPSHOT.entries,
        {
          entryId: 'xrk-mobile',
          moduleName: 'xrk-mobile',
          enabled: true,
          fiberPhase: 'active',
          managed: false,
          version: '1',
          kind: 'tools',
          source: 'phone-guest',
        },
        {
          entryId: 'xrk-mobile-prompt',
          moduleName: 'xrk-mobile-prompt',
          enabled: true,
          fiberPhase: 'active',
          managed: false,
          version: '1',
          kind: 'prompt',
          source: 'phone-guest',
        },
      ],
    } as unknown as Snapshot
    render(<PluginInventorySettingsTab {...props(async () => snap)} />)
    await screen.findByText(en.phoneRuntimeTitle)
    expect(screen.queryByRole('button', { name: /xrk-mobile,/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.phoneRuntimeTitle }))
    expect(screen.getByText(en.phoneRuntimeHint)).toBeTruthy()
    expect(screen.getByText('xrk-mobile')).toBeTruthy()
    expect(screen.getByText('xrk-mobile-prompt')).toBeTruthy()
  })

  it('shows local / update / failed badges and check-updates menu action', async () => {
    const snap = {
      entries: [
        {
          entryId: 'xrkh-better-sidebar',
          moduleName: 'xrkh-better-sidebar',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '0.18.2',
          kind: 'client',
          source: 'xrkh-better-sidebar@0.18.2',
        },
        {
          entryId: 'local-tools',
          moduleName: 'local-tools',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '1.0.0',
          kind: 'process',
          source: 'file:./extensions/local-tools',
        },
        {
          entryId: 'xrkh-file-sidebar',
          moduleName: 'xrkh-file-sidebar',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '0.20.10',
          kind: 'client',
          source: 'file:./extensions/xrkh-better-sidebar',
        },
        {
          entryId: 'broken-pkg',
          moduleName: 'broken-pkg',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '1.0.0',
          kind: 'client',
          source: 'broken-pkg@1.0.0',
        },
      ],
      agentPresets: SNAPSHOT.agentPresets,
    } as unknown as Snapshot
    const checkUpdates = vi.fn(async () => ({
      status: 'ready' as const,
      updates: [
        {
          entryId: 'xrkh-better-sidebar',
          installed: '0.18.2',
          latest: '0.19.0',
          updateAvailable: true,
          sourceClass: 'registry' as const,
        },
        {
          entryId: 'local-tools',
          installed: '1.0.0',
          updateAvailable: false,
          sourceClass: 'local' as const,
        },
        {
          entryId: 'xrkh-file-sidebar',
          installed: '0.20.10',
          latest: '0.20.11',
          updateAvailable: true,
          sourceClass: 'local' as const,
        },
        {
          entryId: 'broken-pkg',
          installed: '1.0.0',
          updateAvailable: false,
          checkFailed: true,
          sourceClass: 'registry' as const,
        },
      ],
    }))
    render(<PluginInventorySettingsTab {...props(async () => snap, { checkUpdates })} />)
    await waitFor(() => {
      expect(checkUpdates).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText(en.updateAvailableTag.replace('{version}', '0.19.0'))).toBeTruthy()
    })
    expect(screen.getByText(en.updateAvailableTag.replace('{version}', '0.20.11'))).toBeTruthy()
    expect(screen.getAllByText(en.localTag).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(en.updateCheckFailedTag)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', {
      name: en.moreActions.replace('{name}', 'better-sidebar'),
    }))
    expect(screen.getByRole('menuitem', { name: en.checkUpdates })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: en.update })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', {
      name: en.moreActions.replace('{name}', 'local-tools'),
    }))
    expect(screen.getByRole('menuitem', { name: en.checkUpdates })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: en.update })).toBeNull()

    fireEvent.click(screen.getByRole('button', {
      name: en.moreActions.replace('{name}', 'file-sidebar'),
    }))
    expect(screen.getByRole('menuitem', { name: en.update })).toBeTruthy()
  })

  it('re-pulls warm probe when Host publishes updates-changed', async () => {
    const snap = {
      entries: [
        {
          entryId: 'side-tools',
          moduleName: 'side-tools',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '1.0.0',
          kind: 'process',
          source: 'side-tools@1.0.0',
        },
      ],
      agentPresets: SNAPSHOT.agentPresets,
    } as unknown as Snapshot
    let notify: (() => void) | undefined
    const checkUpdates = vi.fn(async (_ids?: unknown, force?: boolean) => {
      const call = checkUpdates.mock.calls.length
      if (call <= 1) {
        return {
          status: 'ready' as const,
          updates: [{
            entryId: 'side-tools',
            installed: '1.0.0',
            latest: '1.1.0',
            updateAvailable: true,
            sourceClass: 'registry' as const,
          }],
        }
      }
      expect(force).toBe(false)
      return {
        status: 'ready' as const,
        updates: [{
          entryId: 'side-tools',
          installed: '1.1.0',
          latest: '1.1.0',
          updateAvailable: false,
          sourceClass: 'registry' as const,
        }],
      }
    })
    render(<PluginInventorySettingsTab {...props(async () => snap, {
      checkUpdates,
      subscribeUpdatesChanged: (onChanged) => {
        notify = onChanged
        return () => { notify = undefined }
      },
    })} />)
    await waitFor(() => {
      expect(screen.getByText(en.updateAvailableTag.replace('{version}', '1.1.0'))).toBeTruthy()
    })
    await act(async () => {
      notify?.()
    })
    await waitFor(() => {
      expect(screen.queryByText(en.updateAvailableTag.replace('{version}', '1.1.0'))).toBeNull()
    })
    expect(checkUpdates.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('hides →version badge when inventory already matches probe.latest', async () => {
    const snap = {
      entries: [
        {
          entryId: 'xrkh-better-sidebar-plugin-office',
          moduleName: 'xrkh-better-sidebar-plugin-office',
          enabled: true,
          fiberPhase: 'active',
          managed: true,
          version: '0.1.2',
          kind: 'client',
          source: 'xrkh-better-sidebar-plugin-office@0.1.2',
        },
      ],
      agentPresets: SNAPSHOT.agentPresets,
    } as unknown as Snapshot
    const checkUpdates = vi.fn(async () => ({
      status: 'ready' as const,
      // Stale Host cache still claims updateAvailable after a successful update.
      updates: [{
        entryId: 'xrkh-better-sidebar-plugin-office',
        installed: '0.1.1',
        latest: '0.1.2',
        updateAvailable: true,
        sourceClass: 'registry' as const,
      }],
    }))
    render(<PluginInventorySettingsTab {...props(async () => snap, { checkUpdates })} />)
    await waitFor(() => {
      expect(checkUpdates).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('0.1.2')).toBeTruthy()
    })
    expect(screen.queryByText(en.updateAvailableTag.replace('{version}', '0.1.2'))).toBeNull()
  })
})
