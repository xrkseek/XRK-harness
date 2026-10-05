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
    round: 1,
    prompt: 'first prompt',
    response: 'first response',
    anchor: { kind: 'loaded', key: 'u1' },
  },
  {
    turn: 2,
    round: 2,
    prompt: 'second prompt',
    response: 'second response',
    anchor: { kind: 'loaded', key: 'u2' },
  },
]

describe('TurnNavigator', () => {
  it('still renders a rail for a one-turn session', () => {
    const view = render(
      <TurnNavigator items={items.slice(0, 1)} activeTurn={1} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    expect(view.getByRole('navigation', { name: '轮次导航' })).toBeTruthy()
    expect(view.getByText('第 1 轮')).toBeTruthy()
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
    expect(first.getAttribute('aria-current')).toBeNull()
    expect(second.getAttribute('aria-current')).toBe('true')
    expect(second.className).toMatch(/Active/)
    expect(first.className).not.toMatch(/Active/)
    expect(view.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '跳转到第 1 轮',
      '跳转到第 2 轮',
    ])
    expect(first.className).not.toMatch(/Unloaded/)
    fireEvent.focus(first)
    const preview = view.getByRole('tooltip')
    expect(preview.textContent).toContain('first prompt')
    expect(preview.textContent).toContain('first response')
    expect(preview.nextElementSibling?.textContent).toBe('第 1 轮')
    fireEvent.click(first)
    expect(onNavigate).toHaveBeenCalledWith(items[0])
  })

  it('makes the reading mark longest and the live chat tip medium when scrolled away', () => {
    const view = render(
      <TurnNavigator items={items} activeTurn={1} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    const first = view.getByRole('button', { name: '跳转到第 1 轮' })
    const second = view.getByRole('button', { name: '跳转到第 2 轮' })
    expect(first.getAttribute('aria-current')).toBe('true')
    expect(second.getAttribute('aria-current')).toBeNull()
    expect(first.className).toMatch(/Active/)
    expect(second.className).toMatch(/Chat/)
    expect(second.className).not.toMatch(/Active/)
  })

  it('keeps the floor tick medium for the session newest while reading an older 轮次', () => {
    const camera: readonly TurnRailItem[] = [
      ...Array.from({ length: 10 }, (_, index) => ({
        turn: index + 10,
        round: index + 10,
        prompt: `ask ${String(index + 10)}`,
        response: '',
        anchor: { kind: 'loaded' as const, key: `u${String(index + 10)}` },
      })),
      {
        turn: 30,
        round: 30,
        prompt: 'newest',
        response: '',
        anchor: { kind: 'unloaded' as const, seq: 300 },
      },
    ]
    const view = render(
      <TurnNavigator items={camera} activeTurn={19} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    const reading = view.getByRole('button', { name: '跳转到第 19 轮' })
    const floor = view.getByRole('button', { name: '加载并跳转到第 30 轮' })
    expect(view.getAllByRole('button')).toHaveLength(11)
    expect(reading.className).toMatch(/Active/)
    expect(reading.className).not.toMatch(/Chat/)
    expect(floor.className).toMatch(/Chat/)
    expect(floor.className).not.toMatch(/Active/)
    expect(floor.getAttribute('aria-current')).toBeNull()
  })

  it('keeps a fixed pitch ladder that can scroll when many turns overflow the frame', () => {
    const many: readonly TurnRailItem[] = Array.from({ length: 40 }, (_, index) => ({
      turn: index + 1,
      round: index + 1,
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
    expect(view.getAllByRole('button')[0]?.getAttribute('aria-label')).toBe('跳转到第 1 轮')
    expect(view.getAllByRole('button')[39]?.getAttribute('aria-label')).toBe('跳转到第 40 轮')
    expect(view.getAllByRole('button')[39]?.className).toMatch(/Active/)
    expect(view.getByRole('button', { name: '跳转到第 1 轮' }).className).not.toMatch(/Active/)
  })

  it('labels 轮次 from round, not Host turn id', () => {
    const offset: readonly TurnRailItem[] = [
      {
        turn: 4,
        round: 1,
        prompt: 'open',
        response: 'ok',
        anchor: { kind: 'loaded', key: 'u4' },
      },
      {
        turn: 7,
        round: 2,
        prompt: 'again',
        response: 'done',
        anchor: { kind: 'loaded', key: 'u7' },
      },
    ]
    const view = render(
      <TurnNavigator items={offset} activeTurn={7} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    expect(view.getByRole('button', { name: '跳转到第 1 轮' })).toBeTruthy()
    expect(view.getByRole('button', { name: '跳转到第 2 轮' })).toBeTruthy()
    expect(view.queryByRole('button', { name: '跳转到第 4 轮' })).toBeNull()
    expect(view.getByText('第 2 轮')).toBeTruthy()
  })

  it('portals the ladder into the conversation overlay instead of the transcript', () => {
    const column = document.createElement('div')
    const scroll = document.createElement('div')
    scroll.setAttribute('data-conversation-scroll', '')
    const host = document.createElement('div')
    host.setAttribute('data-turn-rail-host', '')
    column.append(scroll, host)
    document.body.append(column)
    const view = render(
      <TurnNavigator items={items} activeTurn={2} busyTurn={null} onNavigate={vi.fn()} t={t} />,
      { container: scroll },
    )
    // Implicit <nav> has no role attribute — query the element, not [role=…].
    expect(scroll.querySelector('nav')).toBeNull()
    expect(host.querySelector('nav')).not.toBeNull()
    expect(host.querySelectorAll('nav')).toHaveLength(1)
    view.unmount()
    column.remove()
  })
})
