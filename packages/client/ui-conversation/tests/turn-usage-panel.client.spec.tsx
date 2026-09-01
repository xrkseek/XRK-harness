// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TurnTimePanel, TurnUsagePanel } from '../src/client/chat/TurnUsagePanel.tsx'
import type { TurnTokenUsage } from '../src/client/contract/chat-nodes.ts'
import { en, zh, type ConversationKey } from '../src/client/locales.ts'

afterEach(cleanup)

const tZh = ((key: string, params?: Record<string, string | number>) => {
  let text = zh[key as ConversationKey] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}) as never

const tEn = ((key: string, params?: Record<string, string | number>) => {
  let text = en[key as ConversationKey] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}) as never

describe('TurnUsagePanel', () => {
  it('shows an icon-and-total pill and opens the usage dialog on click', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 5_060,
      cacheReadTokens: 4_940,
      cacheWriteTokens: 0,
      outputTokens: 5_800,
      reasoningTokens: 42,
      totalTokens: 15_800,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    }
    render(<TurnUsagePanel usage={usage} t={tEn} />)

    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('Usage 15.8K tok')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Turn usage')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Turn usage15,800 tok')
    const details = dialog.querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details.textContent).toContain('Provider / modeldeepseek/deepseek-chat')
    expect(details.textContent).toContain('Cache hit49.4%')
    expect(details.textContent).toContain('Uncached input5,060 tok')
    expect(details.textContent).toContain('Cached input4,940 tok')
    expect(details.textContent).toContain('Cache write0 tok')
    expect(details.textContent).toContain('Output5,800 tok (42 tok reasoning)')
  })

  it('omits unavailable optional facts instead of inventing values', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    }
    render(<TurnUsagePanel usage={usage} t={tEn} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Provider / model')).toBeNull()
    expect(screen.queryByText('Cache hit')).toBeNull()
    expect(screen.queryByText('Cached input')).toBeNull()
    expect(screen.queryByText('Cache write')).toBeNull()
    expect(screen.queryByText(/reasoning/)).toBeNull()
  })

  it('keeps a partial cache hit below 100 and closes on Escape or outside pointerdown', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 1,
      cacheReadTokens: 999,
      outputTokens: 100,
      totalTokens: 1_100,
    }
    render(<TurnUsagePanel usage={usage} t={tEn} />)
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('Usage 1.1K tok')

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog').textContent).toContain('Cache hit99.9%')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('TurnTimePanel', () => {
  it('opens a details dialog with duration, TTFT, and throughput', () => {
    render(
      <TurnTimePanel runMs={19_000} ttftMs={1_200} tokensPerSecond={20} t={tZh} />,
    )
    const pill = screen.getByRole('button', { name: /用时 19秒/ })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(pill)
    const dialog = screen.getByRole('dialog', { name: '本轮耗时' })
    expect(dialog.textContent).toMatch(/用时/)
    expect(dialog.textContent).toMatch(/19秒/)
    expect(dialog.textContent).toMatch(/首 token/)
    expect(dialog.textContent).toMatch(/1\.2/)
    expect(dialog.textContent).toMatch(/20 tok\/s/)
  })

  it('omits optional rows when metrics are absent', () => {
    render(<TurnTimePanel runMs={5_000} t={tEn} />)
    fireEvent.click(screen.getByRole('button', { name: /Ran for 5s/ }))
    const dialog = screen.getByRole('dialog', { name: 'Turn time' })
    expect(dialog.textContent).toMatch(/Duration/)
    expect(dialog.textContent).not.toMatch(/TTFT|Speed|tok\/s/)
  })
})
