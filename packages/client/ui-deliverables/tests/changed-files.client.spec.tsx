// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import { diffHunkFromWorkspaceFileDiff } from '../src/client/workspace-file-diff-hunk.ts'
import type { ChangesTurnData } from '../src/client/turn-deliverables.ts'
import { en } from '../src/client/locales.ts'

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

describe('diffHunkFromWorkspaceFileDiff', () => {
  it('rebuilds DiffBlock texts from coarse hunks', () => {
    const hunk = diffHunkFromWorkspaceFileDiff({
      kind: 'text',
      path: 'a.ts',
      display: 'a.ts',
      before: false,
      after: true,
      coarse: true,
      hunks: [{
        oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
        lines: ['+one', '+two'],
      }],
    })
    expect(hunk).toEqual({
      path: 'a.ts',
      oldText: null,
      newText: 'one\ntwo\n',
    })
  })
})

describe('ChangedFiles', () => {
  it('loads fileDiff on row click and shows the comparison', async () => {
    const loadFileDiff = vi.fn(async () => ({
      kind: 'text' as const,
      path: 'a.ts',
      display: 'a.ts',
      before: false,
      after: true,
      coarse: true,
      hunks: [{
        oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
        lines: ['+hello'],
      }],
    }))
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
      fireEvent.click(screen.getByLabelText('View diff for a.ts'))
    })
    expect(loadFileDiff).toHaveBeenCalledWith(4, 0, expect.any(AbortSignal))
    expect(await screen.findByText('Preview a.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('Preview a.ts'))
    expect(openFile).toHaveBeenCalledWith('a.ts')
  })
})
