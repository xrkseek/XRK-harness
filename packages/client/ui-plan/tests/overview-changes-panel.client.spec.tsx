// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { OverviewChangesPanel, type OverviewChangesTurn } from '../src/client/OverviewChangesPanel.tsx'

const t = makeTranslate(zh, commonZh)

const turns: readonly OverviewChangesTurn[] = [
  {
    seq: 12,
    turnId: 't1',
    total: 1,
    added: 1,
    deleted: 0,
    files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }],
  },
]

describe('OverviewChangesPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a DiffBlock after fileDiff settles without thrashing', async () => {
    const loadFileDiff = vi.fn(async () => ({
      kind: 'text' as const,
      path: 'a.ts',
      display: 'a.ts',
      before: true,
      after: true,
      coarse: false,
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old', '+new'],
        },
      ],
    }))

    await act(async () => {
      render(
        <OverviewChangesPanel
          sessionId="s1"
          turns={turns}
          loadFileDiff={loadFileDiff}
          openFile={vi.fn()}
          t={t}
        />,
      )
    })

    expect(screen.getByText('回合 t1')).toBeTruthy()
    await waitFor(() => {
      expect(loadFileDiff).toHaveBeenCalledTimes(1)
      expect(document.querySelector('[data-overview-changes]')).toBeTruthy()
    })
    await waitFor(() => {
      expect(document.querySelector('[data-diff]')).toBeTruthy()
    })
    expect(loadFileDiff).toHaveBeenCalledTimes(1)
  })

  it('shows empty copy when there are no turns', () => {
    render(
      <OverviewChangesPanel
        sessionId="s1"
        turns={[]}
        loadFileDiff={vi.fn(async () => null)}
        openFile={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText(zh['preview.changes.empty'])).toBeTruthy()
  })
})
