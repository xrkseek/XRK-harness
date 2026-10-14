// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@xrkseek/client-web-react'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@xrkseek/client-runtime/client'
import { ArchivedSessionsSection } from '../src/client/ArchivedSessionsSection.tsx'
import type { ArchivedSessionsSectionProps } from '../src/client/ArchivedSessionsSection.tsx'
import { archivedZh } from '../src/client/archived-locales.ts'

afterEach(cleanup)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

function summary(id: string, title = id): SessionSummary {
  return {
    id: sid(id),
    displayTitle: title,
    running: false,
    blank: false,
    updatedAt: 1_000,
  }
}

function mount(archived: readonly string[], items: readonly SessionSummary[]) {
  const sessions = createSnapshotStore<SessionListState>({
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: [{
      workspaceId: wid('ws'),
      path: '/proj',
      title: 'Proj',
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies WorkspaceView],
    archivedSessionIds: archived.map(sid),
    pinnedSessionIds: [],
    pinnedWorkspaceIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
  })
  const unarchive = vi.fn(async () => {})
  const deleteSession = vi.fn(async () => {})
  render(<ArchivedSessionsSection {...({
    unarchive,
    deleteSession,
    useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: bindSnapshotSelector(workspaces),
    t: (key: keyof typeof archivedZh, vars?: Record<string, string | number>) => {
      let out: string = archivedZh[key]
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.replace(`{${name}}`, String(value))
        }
      }
      return out
    },
  } as unknown as ArchivedSessionsSectionProps)} />)
  return { unarchive, deleteSession }
}

describe('ArchivedSessionsSection bulk actions', () => {
  it('selects all visible rows and deletes them after confirm', async () => {
    const { deleteSession } = mount(
      ['a', 'b'],
      [summary('a', 'Alpha'), summary('b', 'Beta')],
    )

    fireEvent.click(screen.getByLabelText(archivedZh['bulk.selectAll']))
    expect(screen.getByText('已选 2 项')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: archivedZh['bulk.delete'] }))
    expect(screen.getByText(archivedZh['delete.bulkTitle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: archivedZh.delete }))

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledTimes(2)
    })
    expect(deleteSession).toHaveBeenCalledWith(sid('a'))
    expect(deleteSession).toHaveBeenCalledWith(sid('b'))
  })

  it('bulk-unarchives the current selection', async () => {
    const { unarchive } = mount(
      ['a', 'b'],
      [summary('a', 'Alpha'), summary('b', 'Beta')],
    )

    fireEvent.click(screen.getByLabelText('选择 Alpha'))
    fireEvent.click(screen.getByRole('button', { name: archivedZh['bulk.unarchive'] }))

    await waitFor(() => {
      expect(unarchive).toHaveBeenCalledTimes(1)
    })
    expect(unarchive).toHaveBeenCalledWith(sid('a'))
  })
})
