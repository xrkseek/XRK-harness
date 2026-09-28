// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

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
  it('renders runtime status only for enabled plugins and pins custom actions', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const setEnabled = vi.fn(async () => {})
    const remove = vi.fn(async () => {})
    const update = vi.fn(async () => {})
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
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('9')
    // 6 composition rows (default minimal) + 2 group headings + 9 global cards
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(15)
    expect(screen.getAllByText(en.managedTag).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('0.18.2')).toBeTruthy()
    expect(screen.getAllByText(en.needsRestartTag).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(en.enabledTag).length).toBeGreaterThanOrEqual(8)
    expect(screen.getAllByText(en.disabledTag).length).toBeGreaterThanOrEqual(1)

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
    expect(screen.getByRole('menuitem', { name: en.disable })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: en.remove })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: en.update }))
    await waitFor(() => { expect(update).toHaveBeenCalledWith('xrkh-better-sidebar') })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.toastUpdated.replace('{name}', 'better-sidebar'))
    })

    await openManagedMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: en.disable }))
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
    expect(screen.queryByRole('dialog')).toBeNull()
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
      expect(hint!.textContent).toContain(en.clientRefreshHint)
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

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
