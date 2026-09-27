// @vitest-environment jsdom
/** Conversation assembly acceptance independent of Tool presentation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import type { ISession, SessionId } from '@xrkseek/client-runtime/client'
import type { PropsRenderSlots } from '@xrkseek/client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@xrkseek/client-test-runtime'
import { apply, inject, type EmptyWorkspaceOwnerProps } from '@xrkseek/client-ui-conversation/client'
import { ConversationController } from '../src/client/service.ts'
import type { InputHub } from '../src/client/input/hub.ts'

usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  // afterEach clears navigator; re-pin so LocaleRuntime keeps zh-CN.
  usePinnedBrowserLanguages('zh-CN')
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

function WorkspaceProbe({ open }: EmptyWorkspaceOwnerProps) {
  const [count, setCount] = useState(0)
  return (
    <button data-testid="workspace-probe" onClick={() => { setCount(value => value + 1) }}>
      {String(open)}:{count}
    </button>
  )
}

function composerHost(view: { container: HTMLElement }): HTMLElement {
  const host = view.container.querySelector('[data-composer-input]')
  if (host === null) throw new Error('composer host missing')
  return host as HTMLElement
}

async function bench(opts?: {
  blank?: boolean
  /** Active session (header + docked composer); default is the stub blank/hero seed. */
  active?: boolean
}) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const active = opts?.active === true
  await runtime.sessions.add({
    id: SID,
    summary: {
      title: 'S', displayTitle: 'S', cwd: '/proj',
      ...(active ? { blank: false } : {}),
    },
    snapshot: {
      nodes: [],
      ...(opts?.blank === true
        ? { blank: true, composerPhase: 'blank' as const }
        : active
          ? { blank: false, composerPhase: 'active' as const, openState: 'open' as const }
          : {}),
    },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      loadThrough: vi.fn<ISession['loadThrough']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...inject], apply })
  return runtime
}

describe('resident composer', () => {
  it('renders the locked view state while no session exists at all', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    const view = runtime.renderRoot()
    const host = composerHost(view)
    // Workspace trigger: read-only Lexical host, not aria-disabled (stays clickable).
    expect(host.getAttribute('contenteditable')).toBe('false')
    expect(host.getAttribute('aria-disabled')).toBeNull()
    expect(host.getAttribute('aria-haspopup')).toBe('menu')
    expect(view.getByTestId('workspace-probe').textContent).toBe('false:0')
    fireEvent.click(host)
    expect(view.getByTestId('workspace-probe').textContent).toBe('true:0')
    expect(host.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: '选择工作区' }))
    fireEvent.keyDown(host, { key: 'Enter' })
    expect(view.getByTestId('workspace-probe').textContent).toBe('true:0')
    expect(view.getByRole('button', { name: '选择工作区' })).toBeTruthy()
    await runtime.dispose()
  })

  it('keeps the complete Hero tree mounted when the first Workspace session appears', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    const view = runtime.renderRoot()

    const root = view.container.querySelector('[data-phase="hero"]')!
    const scrollBody = view.container.querySelector('[data-conversation-scroll]')!
    const composerSeat = view.container.querySelector('[data-composer-seat]')!
    const host = composerHost(view)
    const workspaceChip = view.getByRole('button', { name: '选择工作区' })
    const workspaceProbe = view.getByTestId('workspace-probe')
    expect(host.getAttribute('contenteditable')).toBe('false')
    expect(host.getAttribute('aria-disabled')).toBeNull()

    fireEvent.click(workspaceChip)
    fireEvent.click(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')

    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj', blank: true },
      snapshot: { blank: true, composerPhase: 'blank' },
    })

    expect(view.container.querySelector('[data-phase="hero"]')).toBe(root)
    expect(view.container.querySelector('[data-conversation-scroll]')).toBe(scrollBody)
    expect(view.container.querySelector('[data-composer-seat]')).toBe(composerSeat)
    expect(composerHost(view)).toBe(host)
    expect(view.getByRole('button', { name: '选择工作区' })).toBe(workspaceChip)
    expect(view.getByTestId('workspace-probe')).toBe(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')
    expect(host.getAttribute('aria-disabled')).toBeNull()
    expect(host.getAttribute('contenteditable')).toBe('true')
    await runtime.dispose()
  })

  it('the textarea survives the blank→active conversion as the same DOM node', async () => {
    const runtime = await bench({ blank: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    const view = runtime.renderRoot()
    const hero = composerHost(view)
    expect(hero.getAttribute('aria-disabled')).toBeNull()

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.blank = false
      draft.composerPhase = 'active'
    })
    expect(composerHost(view)).toBe(hero)
    await runtime.dispose()
  })

  it('shows hero chrome while openState is cold (pre-history pull)', async () => {
    const runtime = await bench({ blank: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.openState = 'cold'
      draft.composerPhase = 'blank'
      draft.blank = true
    })
    const view = runtime.renderRoot()
    expect(view.container.querySelector('[data-phase="hero"]')).not.toBeNull()
    expect(view.getByText('向阳而生，驭光而行')).toBeTruthy()
    await runtime.dispose()
  })

  it('settling keeps hero chrome while the composer seat stays visible', async () => {
    // summary + live blank must both be false or provenBlank skips settling.
    const runtime = await bench({ active: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.sessions.updateSummary(SID, (draft) => { draft.blank = false })
    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.openState = 'loading'
      draft.composerPhase = 'blank'
      draft.blank = false
    })
    const view = runtime.renderRoot()
    expect(view.container.querySelector('[data-phase="settling"]')).not.toBeNull()
    expect(view.getByText('向阳而生，驭光而行')).toBeTruthy()
    const seat = view.container.querySelector('[data-composer-seat]') as HTMLElement
    expect(seat).not.toBeNull()
    // Settling keeps the resident seat painted (same as skeleton); only the
    // docked-vs-hero choice is deferred until history proves blank/active.
    expect(getComputedStyle(seat).visibility).toBe('visible')
    await runtime.dispose()
  })
})

describe('prompt rejection through the assembled composer', () => {
  it('renders the promptError alert strip and keeps the draft in the machine', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const prompt = vi.fn<ISession['prompt']>(async () => ({
      ok: false, error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj', blank: false },
      snapshot: { blank: false, composerPhase: 'active', openState: 'open' },
      session: { prompt, loadOlder: vi.fn<ISession['loadOlder']>(), loadThrough: vi.fn<ISession['loadThrough']>() },
    })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    const hub = (runtime.ctx.get('conversation') as ConversationController).input as InputHub
    const shell = hub.shell(SID)
    const host = composerHost(view)

    act(() => { shell.setDraft('do not lose this') })
    fireEvent.keyDown(host, { key: 'Enter' })
    await waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.promptError = {
        op: 'send',
        error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
      }
    })
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('prompt rejected before acceptance (agent-busy)')
    await waitFor(() => {
      expect(shell.snapshot.draft).toBe('do not lose this')
    })
    await runtime.dispose()
  })
})

describe('title projection across assembled surfaces', () => {
  it('one summary update re-labels the current-session crumb', async () => {
    const runtime = await bench({ active: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    const view = runtime.renderRoot()
    const hierarchy = view.getByRole('navigation', { name: '会话层级' })
    expect(within(hierarchy).getByRole('button', { name: 'S' }).hasAttribute('disabled')).toBe(true)

    await runtime.sessions.updateSummary(SID, (draft) => {
      draft.displayTitle = '修订标题'
      draft.title = '修订标题'
    })
    await waitFor(() => {
      expect(within(hierarchy).getByRole('button', { name: '修订标题' }).hasAttribute('disabled')).toBe(true)
    })
    expect(within(hierarchy).queryByRole('button', { name: 'S' })).toBeNull()
    await runtime.dispose()
  })
})
