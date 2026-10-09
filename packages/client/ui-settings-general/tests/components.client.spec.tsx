// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@xrkseek/client-web-react'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { DesktopReleaseFooter } from '../src/client/DesktopReleaseFooter.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook, useConnectionState: unusedHook, useConnectionPhase: unusedHook }

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('DesktopReleaseFooter', () => {
  const interpolate: TriggerContentProps['t'] = (key, params) => {
    let text = (en as Record<string, string>)[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }

  afterEach(() => {
    delete (globalThis as { xrkDesktop?: unknown }).xrkDesktop
  })

  it('hides on web when the Desktop bridge is absent', () => {
    const { container } = render(<DesktopReleaseFooter t={interpolate} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses the Host reconnect chip for an available update', async () => {
    const check = vi.fn(async () => ({ phase: 'available' as const, version: '0.5.14' }))
    const snapshot = vi.fn(async () => ({ phase: 'ready' as const, version: '0.5.14', percent: 100 }))
    const install = vi.fn(async () => undefined)
    const subscribe = vi.fn(() => () => undefined)
    ;(globalThis as { xrkDesktop?: unknown }).xrkDesktop = {
      version: async () => '0.5.13',
      updates: { check, snapshot, install, subscribe },
    }
    render(<DesktopReleaseFooter t={interpolate} />)
    const available = await screen.findByRole('button', { name: 'Update 0.5.14' })
    expect(available.className).toContain('warning')
    fireEvent.click(available)
    expect(check).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Software update' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    expect(install).toHaveBeenCalledOnce()
  })

  it('keeps Install disabled until the download reaches ready', async () => {
    let push: ((state: { phase: string; version: string; percent?: number }) => void) | undefined
    const install = vi.fn(async () => undefined)
    ;(globalThis as { xrkDesktop?: unknown }).xrkDesktop = {
      version: async () => '0.5.13',
      updates: {
        check: vi.fn(),
        snapshot: async () => ({ phase: 'available' as const, version: '0.5.15', percent: 12 }),
        install,
        subscribe: (listener: (state: { phase: string; version: string; percent?: number }) => void) => {
          push = listener
          return () => undefined
        },
      },
    }
    render(<DesktopReleaseFooter t={interpolate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update 0.5.15' }))
    const installBtn = screen.getByRole('button', { name: 'Install and restart' })
    expect(installBtn.hasAttribute('disabled')).toBe(true)
    fireEvent.click(installBtn)
    expect(install).not.toHaveBeenCalled()
    push?.({ phase: 'ready', version: '0.5.15', percent: 100 })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install and restart' }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    expect(install).toHaveBeenCalledOnce()
  })

  it('shows the installed version as a status chip when no update is waiting', async () => {
    ;(globalThis as { xrkDesktop?: unknown }).xrkDesktop = {
      version: async () => '0.5.13',
      updates: {
        check: vi.fn(),
        snapshot: async () => ({ phase: 'idle' as const }),
        install: vi.fn(),
        subscribe: () => () => undefined,
      },
    }
    render(<DesktopReleaseFooter t={interpolate} />)
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'v0.5.13' })).toBeTruthy()
    })
  })

  it('starts an update check on the first idle-chip click', async () => {
    let resolveCheck!: (state: { phase: 'idle' }) => void
    const check = vi.fn(() => new Promise<{ phase: 'idle' }>((resolve) => {
      resolveCheck = resolve
    }))
    ;(globalThis as { xrkDesktop?: unknown }).xrkDesktop = {
      version: async () => '0.5.13',
      updates: {
        check,
        snapshot: async () => ({ phase: 'idle' as const }),
        install: vi.fn(),
        subscribe: () => () => undefined,
      },
    }
    render(<DesktopReleaseFooter t={interpolate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates v0.5.13' }))
    expect(check).toHaveBeenCalledOnce()
    const dialog = screen.getByRole('dialog', { name: 'Software update' })
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toMatch(/Checking for updates/)
    resolveCheck({ phase: 'idle' })
    await waitFor(() => {
      expect(dialog.textContent).toMatch(/You are on the latest version/)
    })
  })

  it('shows download progress in the in-app dialog', async () => {
    let push: ((state: { phase: 'installing'; version: string; percent: number }) => void) | undefined
    ;(globalThis as { xrkDesktop?: unknown }).xrkDesktop = {
      version: async () => '0.5.13',
      updates: {
        check: vi.fn(),
        snapshot: async () => ({ phase: 'available' as const, version: '0.5.14' }),
        install: vi.fn(async () => undefined),
        subscribe: (listener: (state: { phase: 'installing'; version: string; percent: number }) => void) => {
          push = listener
          return () => undefined
        },
      },
    }
    render(<DesktopReleaseFooter t={interpolate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update 0.5.14' }))
    push?.({ phase: 'installing', version: '0.5.14', percent: 42 })
    const bar = await screen.findByRole('progressbar', { name: '42%' })
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, t, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the intro and the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy()
    expect(screen.getByText(/Session defaults and appearance/)).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      rpcId: 'document-open' as never,
      result: { ok: true as const, value: { opened: true as const } },
    }))
    const controller = new SettingsDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument,
      },
    } as never)
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith({}) })
  })

  it('stays absent without a document and retries availability after remount', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'document-action-absent' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } },
      })
      .mockResolvedValueOnce({
        rpcId: 'document-action-ready' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
      })
    const controller = new SettingsDocumentStore({
      settings: {
        describe,
        openDocument: vi.fn(),
      },
    } as never)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = new SettingsDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument: vi.fn(() => Promise.resolve({
          rpcId: 'document-open-failed' as never,
          result: { ok: false as const, error: { code: 'internal' as const, message: 'xdg-open missing', details: {} } },
        })),
      },
    } as never)
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
