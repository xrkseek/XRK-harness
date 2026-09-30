// @vitest-environment jsdom
/**
 * AppRoot boot-gate smoke: loading page until the settled signal flips (status
 * alone never opens the gate), fail-loud entry list + boot failure report,
 * one-pass switch to the real UI. The full browser chain (real module system
 * + vendored Loader + bundles) is the e2e's job; this pins the shell-owned
 * gate semantics. Stores are the kernel-own signals production boot uses
 * (shell self-sufficiency: the loading page depends on no plugin package).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-xrk-booting')
  document.documentElement.removeAttribute('lang')
  delete (globalThis as { xrkDesktop?: unknown }).xrkDesktop
})
import { AppRoot } from '@xrkseek/client-web/src/AppRoot.tsx'
import { createLoaderStatusStore, createSignal } from '@xrkseek/client-web/src/loader-status.ts'

/** Pin English so zh navigator locales do not flip default splash copy. */
const en = createSignal<'zh' | 'en'>('en')

function mount() {
  const settled = createSignal(false)
  const error = createSignal<string | undefined>(undefined)
  const status = createLoaderStatusStore()
  let renders = 0
  const utils = render(
    <AppRoot
      settled={settled}
      status={status}
      error={error}
      lang={en}
      renderApp={() => { renders += 1; return <div data-testid="real-ui" /> }}
    />,
  )
  return { settled, status, error, counts: () => renders, ...utils }
}

describe('AppRoot', () => {
  it('shows the loading page and never calls renderApp before settled', () => {
    const { queryByTestId, counts, getByText } = mount()
    expect(getByText('HARNESS')).toBeTruthy()
    expect(getByText('Summoning plugins…')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
    expect(counts()).toBe(0)
  })

  it('updates the progressive boot hint while still gated', () => {
    const settled = createSignal(false)
    const error = createSignal<string | undefined>(undefined)
    const status = createLoaderStatusStore()
    const hint = createSignal('Summoning plugins…')
    const { getByText, queryByTestId, rerender } = render(
      <AppRoot
        settled={settled}
        status={status}
        error={error}
        hint={hint}
        lang={en}
        renderApp={() => <div data-testid="real-ui" />}
      />,
    )
    expect(getByText('Summoning plugins…')).toBeTruthy()
    act(() => { hint.set('Starting Host…') })
    rerender(
      <AppRoot
        settled={settled}
        status={status}
        error={error}
        hint={hint}
        lang={en}
        renderApp={() => <div data-testid="real-ui" />}
      />,
    )
    expect(getByText('Starting Host…')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('all-active status alone does not open the gate (settled signal is the only key)', () => {
    const { status, queryByTestId } = mount()
    act(() => {
      status.set('a', 'active')
      status.set('b', 'active')
    })
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('lists failed entries and stays on the loading page', () => {
    const { status, getByText, queryByTestId } = mount()
    act(() => {
      status.set('@xrkseek/client-ui-layout', 'failed')
      status.set('ok', 'active')
    })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText('@xrkseek/client-ui-layout')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('renders the boot failure report even when no entry projected failed', () => {
    const { error, getByText, queryByTestId } = mount()
    act(() => { error.set('web boot: 1 entry did not activate\nx: pending (waiting for service: y)') })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText(/waiting for service/)).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('renders Chinese fail copy when lang is zh', () => {
    const settled = createSignal(false)
    const error = createSignal<string | undefined>(undefined)
    const status = createLoaderStatusStore()
    const zh = createSignal<'zh' | 'en'>('zh')
    const { getByText, queryByTestId } = render(
      <AppRoot
        settled={settled}
        status={status}
        error={error}
        lang={zh}
        renderApp={() => <div data-testid="real-ui" />}
      />,
    )
    act(() => { status.set('bad', 'failed') })
    expect(getByText('插件加载失败')).toBeTruthy()
    expect(getByText('bad')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('stamps data-xrk-booting until settled and clears after product paint', async () => {
    const { settled, getByTestId } = mount()
    expect(document.documentElement.hasAttribute('data-xrk-booting')).toBe(true)
    act(() => { settled.set(true) })
    // Splash still covers while the first product frame commits.
    expect(document.documentElement.hasAttribute('data-xrk-booting')).toBe(true)
    expect(getByTestId('real-ui')).toBeTruthy()
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { resolve() })
        })
      })
    })
    expect(document.documentElement.hasAttribute('data-xrk-booting')).toBe(false)
  })

  it('renders Desktop window chrome on splash when xrkDesktop.window exists', async () => {
    const calls: string[] = []
    ;(globalThis as {
      xrkDesktop?: {
        window: {
          minimize: () => Promise<void>
          toggleMaximize: () => Promise<void>
          close: () => Promise<void>
          isMaximized: () => Promise<boolean>
          subscribeMaximized: (fn: (v: boolean) => void) => () => void
          reload: () => Promise<void>
        }
        platform: string
      }
    }).xrkDesktop = {
      platform: 'win32',
      window: {
        minimize: async () => { calls.push('minimize') },
        toggleMaximize: async () => { calls.push('toggleMaximize') },
        close: async () => { calls.push('close') },
        isMaximized: async () => false,
        subscribeMaximized: () => () => {},
        reload: async () => { calls.push('reload') },
      },
    }
    const { getByLabelText, settled, queryByLabelText } = mount()
    expect(getByLabelText('Reload')).toBeTruthy()
    expect(getByLabelText('Minimize')).toBeTruthy()
    expect(getByLabelText('Close')).toBeTruthy()
    act(() => { settled.set(true) })
    // Splash (and boot chrome) stay until the product paint reveal.
    expect(getByLabelText('Reload')).toBeTruthy()
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { resolve() })
        })
      })
    })
    expect(queryByLabelText('Reload')).toBeNull()
  })

  it('flipping settled switches to the real UI in one pass', async () => {
    const { settled, getByTestId, queryByText, counts } = mount()
    act(() => { settled.set(true) })
    // Product UI mounts under the splash this commit.
    expect(getByTestId('real-ui')).toBeTruthy()
    expect(queryByText('HARNESS')).toBeTruthy()
    expect(counts()).toBe(1)
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { resolve() })
        })
      })
    })
    expect(queryByText('HARNESS')).toBeNull()
  })
})
