// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import type { ChangesTurnData } from '../src/client/turn-deliverables.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function t(key: keyof typeof en, params?: Record<string, string>): string {
  let text = en[key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, value)
    }
  }
  return text
}

const changes: ChangesTurnData = {
  seq: 4,
  turnId: 'turn_1',
  cwd: '/w',
  files: [
    { path: 'a.ts', display: 'a.ts', added: 2, deleted: 0 },
    { path: 'b.ts', display: 'b.ts', added: 1, deleted: 1 },
  ],
  total: 2,
  added: 3,
  deleted: 1,
}

function textDiff(path: string, line: string) {
  return {
    kind: 'text' as const,
    path,
    display: path,
    before: false,
    after: true,
    coarse: true,
    hunks: [{
      oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
      lines: [line],
    }],
  }
}

describe('ChangedFiles review navigation', () => {
  it('opens a single review pane from the header and loads fileDiff', async () => {
    const loadFileDiff = vi.fn(async (_seq: number, index: number) =>
      textDiff(index === 0 ? 'a.ts' : 'b.ts', index === 0 ? '+hello' : '+world'))
    const openFile = vi.fn()
    render(
      <ChangedFiles
        changes={changes}
        loadFileDiff={loadFileDiff}
        openFile={openFile}
        t={t}
      />,
    )
    expect(screen.getByText('a.ts')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Review this turn’s changes in Status'))
    })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 0, expect.any(AbortSignal))
    expect(await screen.findByLabelText('Select a file to review')).toBeTruthy()
    expect(await screen.findByText('Created in this turn')).toBeTruthy()
    expect(await screen.findByText('Preview a.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('Preview a.ts'))
    expect(openFile).toHaveBeenCalledWith('a.ts')
  })

  it('header prefers openOverviewReview over the inline pane', async () => {
    const openOverviewReview = vi.fn()
    const loadFileDiff = vi.fn(async () => textDiff('a.ts', '+hello'))
    render(
      <ChangedFiles
        changes={changes}
        loadFileDiff={loadFileDiff}
        openFile={vi.fn()}
        openOverviewReview={openOverviewReview}
        t={t}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Review this turn’s changes in Status'))
    })
    expect(openOverviewReview).toHaveBeenCalledWith(0)
    expect(loadFileDiff).not.toHaveBeenCalled()
    expect(document.querySelector('[data-changes-review]')).toBeNull()
  })

  it('switches the review file via the selector menu', async () => {
    const loadFileDiff = vi.fn(async (_seq: number, index: number) =>
      textDiff(index === 0 ? 'a.ts' : 'b.ts', index === 0 ? '+hello' : '+world'))
    const { container } = render(
      <ChangedFiles
        changes={changes}
        loadFileDiff={loadFileDiff}
        openFile={vi.fn()}
        t={t}
      />,
    )
    const list = container.querySelector('[data-changed-files] ul')
    expect(list).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(list as HTMLElement).getByLabelText('View diff for a.ts'))
    })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 0, expect.any(AbortSignal))
    expect(await screen.findByText('Preview a.ts')).toBeTruthy()
    expect(container.querySelectorAll('[data-changes-review]')).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Select a file to review'))
    })
    const menu = document.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(menu as HTMLElement).getByText('b.ts'))
    })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 1, expect.any(AbortSignal))
    expect(await screen.findByText('Preview b.ts')).toBeTruthy()
    expect(container.querySelectorAll('[data-changes-review]')).toHaveLength(1)
  })

  it('shows deleted note and removed lines for a whole-file delete', async () => {
    const loadFileDiff = vi.fn(async () => ({
      kind: 'text' as const,
      path: 'gone.ts',
      display: 'gone.ts',
      before: true,
      after: false,
      coarse: true,
      hunks: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 0,
        lines: ['-gone'],
      }],
    }))
    render(
      <ChangedFiles
        changes={{
          ...changes,
          files: [{ path: 'gone.ts', display: 'gone.ts', added: 0, deleted: 1 }],
          total: 1,
          added: 0,
          deleted: 1,
        }}
        loadFileDiff={loadFileDiff}
        openFile={vi.fn()}
        t={t}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Review this turn’s changes in Status'))
    })
    expect(await screen.findByText('Deleted in this turn')).toBeTruthy()
    expect(document.querySelector('[data-diff]')).toBeTruthy()
    expect(screen.getByText('gone')).toBeTruthy()
  })

  it('keeps unchanged note without a DiffBlock stub when hunks are empty', async () => {
    const loadFileDiff = vi.fn(async () => ({
      kind: 'text' as const,
      path: 'a.ts',
      display: 'a.ts',
      before: true,
      after: true,
      coarse: true,
      hunks: [],
    }))
    render(
      <ChangedFiles
        changes={changes}
        loadFileDiff={loadFileDiff}
        openFile={vi.fn()}
        t={t}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Review this turn’s changes in Status'))
    })
    expect(await screen.findByText('Unchanged content (metadata-only or empty comparison)')).toBeTruthy()
    expect(document.querySelector('[data-diff]')).toBeNull()
    expect(screen.getByText('Preview a.ts')).toBeTruthy()
  })

  it('loads a hover diff preview after 500ms without opening the review pane', async () => {
    vi.useFakeTimers()
    const loadFileDiff = vi.fn(async () => textDiff('a.ts', '+hello'))
    const { container } = render(
      <ChangedFiles
        changes={changes}
        loadFileDiff={loadFileDiff}
        openFile={vi.fn()}
        t={t}
      />,
    )
    const row = screen.getByLabelText('View diff for a.ts')
    const wrapper = row.parentElement as HTMLElement
    fireEvent.pointerEnter(wrapper)
    expect(loadFileDiff).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(document.querySelector('[data-changes-hover-preview]')).toBeTruthy()
    // Flush the preview's loadFileDiff microtask under fake timers.
    await act(async () => { await Promise.resolve() })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 0, expect.any(AbortSignal))
    expect(screen.getByText('Created in this turn')).toBeTruthy()
    expect(container.querySelector('[data-changes-review]')).toBeNull()
  })
})
