// @vitest-environment jsdom

// Branch vs regenerate/restore gating. Branch is a turn-cut fork anchored on
// the turn's own `turn/end`, so a completed turn stays branchable with later
// turns below it; regenerate/restore rewrite the tail and need the tip.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(() => { cleanup() })

function renderActions(tipUnavailable?: boolean) {
  const onBranch = vi.fn()
  const onRegenerate = vi.fn()
  const onRestore = vi.fn()
  render(
    <MessageIconActions
      text="answer"
      time={1}
      clock="end"
      onBranch={onBranch}
      onRegenerate={onRegenerate}
      onRestore={onRestore}
      tipUnavailable={tipUnavailable}
      t={t}
    />,
  )
  return { onBranch, onRegenerate, onRestore }
}

function disabled(name: string): string | null {
  return screen.getByRole('button', { name }).getAttribute('aria-disabled')
}

describe('MessageIconActions gating', () => {
  it('keeps branch live on a mid-history turn while the tip-only actions stay gated', () => {
    const { onBranch } = renderActions(true)

    const branch = screen.getByRole('button', { name: t('message.branch') })
    expect(branch.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(branch)
    expect(onBranch).toHaveBeenCalledTimes(1)

    expect(disabled(t('message.regenerate'))).toBe('true')
    expect(disabled(t('message.restore'))).toBe('true')
  })

  it('enables all three on the tip', () => {
    const { onRegenerate, onRestore } = renderActions(false)

    expect(disabled(t('message.branch'))).toBeNull()
    expect(disabled(t('message.regenerate'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('message.restore') }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRegenerate).not.toHaveBeenCalled()
  })
})
