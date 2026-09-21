// @vitest-environment jsdom
/** Plan / Office preview tabs read existing RPC envelopes; they do not invent fields. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { PreviewOpenButton, PreviewTabs, type PreviewTabsProps } from '../src/client/PreviewTabs.tsx'
import { parseOfficePreview, parsePlanPreview } from '../src/client/preview-load.ts'

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
  it('shows plan flags, switches to Office, and closes the column', async () => {
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
        } as PreviewTabsProps)}
      />,
    )
    expect(screen.getByText('正在读取预览')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getByText('是')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Office' }))
    expect(screen.getByText('已配置')).toBeTruthy()
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shows unavailable when the preview body is not the existing envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('预览不可用')).toBeTruthy()
    })
  })
})

describe('PreviewOpenButton', () => {
  it('opens the details column', () => {
    const openPreview = vi.fn()
    render(<PreviewOpenButton openPreview={openPreview} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(openPreview).toHaveBeenCalledTimes(1)
  })
})
