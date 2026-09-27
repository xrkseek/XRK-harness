// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import type { ChangesTurnData } from '../src/client/turn-deliverables.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
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
      fireEvent.click(screen.getByLabelText('Open changes review'))
    })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 0, expect.any(AbortSignal))
    expect(await screen.findByLabelText('Select a file to review')).toBeTruthy()
    expect(await screen.findByText('Preview a.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('Preview a.ts'))
    expect(openFile).toHaveBeenCalledWith('a.ts')
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
})
