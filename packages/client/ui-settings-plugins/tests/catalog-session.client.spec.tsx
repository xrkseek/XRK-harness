// @vitest-environment jsdom
/**
 * Runtime / Inject catalogs: per-session cache paints last-good immediately,
 * search chrome does not bleed across sessions, and soft refresh keeps the list.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionToolsValue } from '@xrkseek/client-connection/client'
import { ToolsCatalogTab } from '../src/client/ToolsCatalogTab.tsx'
import { resetCatalogPaintForTests } from '../src/client/catalog-session-cache.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

beforeEach(() => {
  resetCatalogPaintForTests()
})

const t = (key: keyof typeof en, params?: Record<string, string>) => {
  let text = en[key]
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v)
    }
  }
  return text
}

function toolsValue(name: string): SessionToolsValue {
  return {
    agentPreset: 'harness',
    cwd: `/ws/${name}`,
    workspaceLabel: name,
    disclosure: { direct: 1, deferred: 0, expanded: 0 },
    tools: [
      {
        name: `${name}-tool`,
        description: `${name} tool`,
        group: 'preset',
        surface: 'system',
        exposure: 'direct',
        onModel: true,
      },
    ],
  }
}

describe('ToolsCatalogTab session cache', () => {
  it('keeps last-good paint when switching back, and restores search chrome', async () => {
    const listTools = vi.fn(async (sessionId: string) => {
      await new Promise((r) => setTimeout(r, 20))
      return toolsValue(sessionId === 'a' ? 'alpha' : 'beta')
    })

    let sessionId: string | undefined = 'a'
    const { rerender } = render(
      <ToolsCatalogTab
        t={t}
        currentSessionId={() => sessionId}
        listTools={listTools as never}
      />,
    )

    await waitFor(() => expect(screen.getByText('/ws/alpha')).toBeTruthy())
    fireEvent.change(screen.getByLabelText(en.catalogSearch), {
      target: { value: 'alp' },
    })

    sessionId = 'b'
    rerender(
      <ToolsCatalogTab
        t={t}
        currentSessionId={() => sessionId}
        listTools={listTools as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('/ws/beta')).toBeTruthy())
    expect(screen.queryByText('/ws/alpha')).toBeNull()
    expect((screen.getByLabelText(en.catalogSearch) as HTMLInputElement).value).toBe('')

    listTools.mockImplementation(async (id: string) => {
      await new Promise((r) => setTimeout(r, 80))
      return toolsValue(id === 'a' ? 'alpha' : 'beta')
    })
    sessionId = 'a'
    rerender(
      <ToolsCatalogTab
        t={t}
        currentSessionId={() => sessionId}
        listTools={listTools as never}
      />,
    )

    expect(screen.getByText('/ws/alpha')).toBeTruthy()
    expect(screen.queryByText(en.catalogLoading)).toBeNull()
    expect((screen.getByLabelText(en.catalogSearch) as HTMLInputElement).value).toBe('alp')

    await waitFor(() => expect(listTools.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(screen.getByText('/ws/alpha')).toBeTruthy()
  })

  it('keeps last-good when a background refresh fails', async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce(toolsValue('alpha'))
      .mockRejectedValueOnce(new Error('boom'))

    render(
      <ToolsCatalogTab
        t={t}
        currentSessionId={() => 'a'}
        listTools={listTools as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('/ws/alpha')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: en.catalogRefresh }))
    await waitFor(() => expect(listTools).toHaveBeenCalledTimes(2))
    expect(screen.getByText('/ws/alpha')).toBeTruthy()
    expect(screen.queryByText(en.catalogError)).toBeNull()
  })
})
