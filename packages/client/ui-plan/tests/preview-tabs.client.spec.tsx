// @vitest-environment jsdom
/** Session overview tabs: live plan/todos projections + office RPC. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { PreviewOpenButton, PreviewTabs, type PreviewTabsProps } from '../src/client/PreviewTabs.tsx'
import { parseOfficePreview, parsePlanPreview } from '../src/client/preview-load.ts'
import { LAYOUT_INSET_ATTR } from '@xrkseek/client-ui-layout/client'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A `useProjection` stand-in with flipable plan / todos values. */
function fakeProjections(initial: {
  plan?: { active: boolean; pending: boolean }
  todos?: { content: string; status: string }[] | null
}) {
  const state = {
    plan: initial.plan,
    todos: initial.todos === undefined ? null : initial.todos,
  }
  const useProjection = vi.fn((key: string) => {
    if (key === 'plan') return state.plan
    if (key === 'todos') return state.todos
    return undefined
  })
  return { state, useProjection: useProjection as unknown as PreviewTabsProps['useProjection'] }
}

describe('preview envelopes', () => {
  it('reads plan.preview and office status shapes and rejects others', () => {
    expect(parsePlanPreview({ ok: true, value: { active: true, pending: false } })).toEqual({
      active: true,
      pending: false,
    })
    expect(parsePlanPreview({ ok: false })).toBeNull()
    expect(parseOfficePreview({
      result: { ok: true, value: { configured: true, connected: false } },
    })).toEqual({ configured: true, connected: false })
    expect(parseOfficePreview({ result: { ok: true, value: { state: 'idle' } } })).toBeNull()
  })
})

describe('PreviewTabs', () => {
  it('shows standing todos from the live projection', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    const { useProjection } = fakeProjections({
      todos: [
        { content: 'ship overview', status: 'in_progress' },
        { content: 'docs', status: 'pending' },
      ],
    })
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
        } as PreviewTabsProps)}
      />,
    )
    expect(screen.getByText('ship overview')).toBeTruthy()
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '概况' })).toBeTruthy()
  })

  it('falls back to the preview RPC where plan mode is not composed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('plan.preview')) {
        return jsonResponse({ ok: true, value: { active: true, pending: false } })
      }
      return jsonResponse({
        result: { ok: true, value: { configured: false, connected: false } },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const closeDetails = vi.fn()
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails,
          t,
          useProjection: fakeProjections({}).useProjection,
        } as PreviewTabsProps)}
      />,
    )
    expect(screen.getByText(/尚无站立计划/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '计划' }))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getByText('是')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Office' }))
    expect(screen.getByText('已配置')).toBeTruthy()
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '关闭概况栏' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })

  it('rides the live plan projection instead of the mount-time snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    const { state, useProjection } = fakeProjections({ plan: { active: false, pending: false } })
    const props = { sessionId: 's1', closeDetails: vi.fn(), t, useProjection } as PreviewTabsProps
    const view = render(<PreviewTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '计划' }))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    state.plan = { active: true, pending: false }
    view.rerender(<PreviewTabs {...props} />)
    expect(screen.getByText('是')).toBeTruthy()
  })
})

describe('PreviewOpenButton', () => {
  it('opens the details column and says what it opens', () => {
    const openPreview = vi.fn()
    const closePreview = vi.fn()
    document.documentElement.removeAttribute(LAYOUT_INSET_ATTR.details)
    render(<PreviewOpenButton openPreview={openPreview} closePreview={closePreview} t={t} />)
    const button = screen.getByRole('button', { name: '概况' })
    expect(button.getAttribute('title')).toBe('打开右侧概况栏：站立计划、计划模式与 Office')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(closePreview).not.toHaveBeenCalled()
  })

  it('closes the details column when it is already open', () => {
    document.documentElement.setAttribute(LAYOUT_INSET_ATTR.details, '')
    const openPreview = vi.fn()
    const closePreview = vi.fn()
    render(<PreviewOpenButton openPreview={openPreview} closePreview={closePreview} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '概况' }))
    expect(closePreview).toHaveBeenCalledTimes(1)
    expect(openPreview).not.toHaveBeenCalled()
    document.documentElement.removeAttribute(LAYOUT_INSET_ATTR.details)
  })
})
