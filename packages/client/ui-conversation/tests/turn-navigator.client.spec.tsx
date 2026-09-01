// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TurnRailItem } from '../src/client/chat/turn-rail-items.ts'
import { TurnNavigator } from '../src/client/chat/TurnNavigator.tsx'
import { zh, type ConversationKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: string, params?: Record<string, string | number>) => {
  let text = zh[key as ConversationKey] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}) as never

const items: readonly TurnRailItem[] = [
  {
    turn: 1,
    prompt: 'first prompt',
    response: 'first response',
    anchor: { kind: 'loaded', key: 'u1' },
  },
  {
    turn: 2,
    prompt: 'second prompt',
    response: 'second response',
    anchor: { kind: 'loaded', key: 'u2' },
  },
]

describe('TurnNavigator', () => {
  it('renders nothing when fewer than two turns are loaded', () => {
    const view = render(
      <TurnNavigator items={items.slice(0, 1)} activeTurn={1} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('shows prompt/response preview on mark focus and reports navigation', () => {
    const onNavigate = vi.fn()
    const view = render(
      <TurnNavigator items={items} activeTurn={2} busyTurn={null} onNavigate={onNavigate} t={t} />,
    )
    const navigation = view.getByRole('navigation', { name: '轮次导航' })
    expect(navigation.style.getPropertyValue('--turn-natural-height')).toBe('22px')
    // Active-mark follow may scroll the ladder; only the natural height is fixed.
    const first = view.getByRole('button', { name: '跳转到第 1 轮' })
    const second = view.getByRole('button', { name: '跳转到第 2 轮' })
    expect(second.getAttribute('aria-current')).toBe('true')
    fireEvent.focus(first)
    const preview = view.getByRole('tooltip')
    expect(preview.textContent).toContain('first prompt')
    expect(preview.textContent).toContain('first response')
    fireEvent.click(first)
    expect(onNavigate).toHaveBeenCalledWith(items[0])
  })

  it('keeps a fixed pitch ladder that can scroll when many turns overflow the frame', () => {
    const many: readonly TurnRailItem[] = Array.from({ length: 40 }, (_, index) => ({
      turn: index + 1,
      prompt: `prompt ${String(index + 1)}`,
      response: `response ${String(index + 1)}`,
      anchor: { kind: 'loaded' as const, key: `u${String(index + 1)}` },
    }))
    const view = render(
      <TurnNavigator items={many} activeTurn={40} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    const navigation = view.getByRole('navigation', { name: '轮次导航' })
    // 39 gaps × 10px + 2 × 6px inset
    expect(navigation.style.getPropertyValue('--turn-natural-height')).toBe('402px')
    expect(view.getAllByRole('button')).toHaveLength(40)
  })
})
