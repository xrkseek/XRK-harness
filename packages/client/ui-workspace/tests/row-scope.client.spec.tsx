// @vitest-environment jsdom
/**
 * Row render-scope spec: one session's facts changing must re-render that row
 * only. The proof is a render counter, not a DOM assertion — a sibling row that
 * re-renders to identical DOM would still cost a full row pass (HoverCard,
 * menu array, closures), which is exactly what the memo/comparator work is for.
 *
 * `HoverCard` is the per-row wrapper every session/workspace row renders once,
 * so swapping it for a counting passthrough makes row passes observable from
 * outside the components under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { bindSnapshotSelector } from '@xrkseek/client-web-react'
import type { HostDescription } from '@xrkseek/client-connection/client'
import {
  createSnapshotStore,
  type SessionId, type SessionListState, type SessionSummary,
  type WorkspaceId, type WorkspaceListState, type WorkspaceView,
} from '@xrkseek/client-runtime/client'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { WorkspaceBrowser } from '../src/client/WorkspaceBrowser.tsx'
import { zh } from '../src/client/locales.ts'

/** Row passes per row title (HoverCard `copyText`), shared with the hoisted mock. */
const rowRenders = vi.hoisted(() => new Map<string, number>())

vi.mock('@xrkseek/client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xrkseek/client-ui-primitives')>()
  return {
    ...actual,
    HoverCard: ({ anchor, copyText }: { anchor: ReactNode; copyText?: string | undefined }) => {
      const key = copyText ?? '(no-copy)'
      rowRenders.set(key, (rowRenders.get(key) ?? 0) + 1)
      return <>{anchor}</>
    },
  }
})

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); rowRenders.clear() })

const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const summary = (id: string, updatedAt: number): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt,
})

const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {},
  currentAddress: undefined,
})

const workspace = (id: string, sessionIds: readonly SessionId[]): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title: id,
  sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

const workspaceState = (items: readonly WorkspaceView[]): WorkspaceListState => ({
  items, archivedSessionIds: [], pinnedSessionIds: [], pinnedWorkspaceIds: [],
  state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  recentWorkspaceId: items[0]?.workspaceId,
})

/** Static snapshot hook: same shape as the slot's selector hooks, no updates. */
function fixed<T>(snapshot: T) {
  return <S,>(selector: (state: T) => S): S => selector(snapshot)
}

const NOW = Date.parse('2026-02-01T00:00:00.000Z')
const ALPHA = summary('Alpha', NOW - 5 * 60_000)
const BETA = summary('Beta', NOW - 90 * 60_000)

/** One live session list (two rows in one Workspace) plus the browser chrome. */
function mountSessions(groupBy: 'workspace' | 'flat') {
  const sessions = createSnapshotStore<SessionListState>(sessionState([ALPHA, BETA]))
  const store = createWorkspaceViewStore().create()
  store.actions.setOrderBy('manual')
  store.actions.setGroupBy(groupBy)
  if (groupBy === 'workspace') store.actions.setGroupExpanded('ws1', true)
  const props: WorkspaceBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: fixed(workspaceState([workspace('ws1', [ALPHA.id, BETA.id])])),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    startSession: vi.fn(),
    open: vi.fn(),
    searchSessions: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn(),
    renameWorkspace: vi.fn(async () => {}),
    deleteWorkspace: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    pinSession: vi.fn(async () => {}),
    unpinSession: vi.fn(async () => {}),
    insertWorkspaceBefore: vi.fn(async () => {}),
    insertSessionBefore: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => workspace('created', [])),
    useDirectoryFlow: fixed(true),
    useHostDescription: fixed<HostDescription | undefined>(undefined),
    renderSlot: (() => null) as never,
    t,
  }
  render(<WorkspaceBrowser {...props} />)
  return sessions
}

/** Rewrite one session's facts through the store (a list push, not a remount). */
function touch(sessions: ReturnType<typeof mountSessions>, id: string, updatedAt: number): void {
  act(() => {
    sessions.update((draft) => {
      const row = draft.byId[sid(id)]
      if (row !== undefined) row.updatedAt = updatedAt
    })
  })
}

describe('sidebar row render scope', () => {
  it('re-renders only the changed row in the grouped tree', () => {
    const sessions = mountSessions('workspace')
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    rowRenders.clear()

    touch(sessions, 'Alpha', NOW + 60_000)

    expect(rowRenders.get('Alpha')).toBe(1)
    // The sibling's node facts are unchanged: no row pass at all.
    expect(rowRenders.get('Beta')).toBeUndefined()
    // The header row (copyText = cwd) is memoized the same way.
    expect(rowRenders.get('/projects/ws1')).toBeUndefined()
  })

  it('re-renders only the changed row in the flat list', () => {
    const sessions = mountSessions('flat')
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    rowRenders.clear()

    touch(sessions, 'Beta', NOW + 120_000)

    expect(rowRenders.get('Beta')).toBe(1)
    expect(rowRenders.get('Alpha')).toBeUndefined()
  })

  it('re-renders only the rows whose selection flips', () => {
    const sessions = mountSessions('workspace')
    rowRenders.clear()

    act(() => {
      sessions.update((draft) => { draft.current = sid('Alpha') })
    })

    expect(rowRenders.get('Alpha')).toBe(1)
    expect(rowRenders.get('Beta')).toBeUndefined()
  })

  it('keeps every row when an unrelated list field changes (jobs mirror)', () => {
    const sessions = mountSessions('workspace')
    rowRenders.clear()

    // `jobsBySession` rides the same snapshot at chat frequency; the derivation
    // slice is unchanged, so neither the tree nor a row may re-render.
    act(() => {
      sessions.update((draft) => {
        draft.jobsBySession = { [sid('Alpha')]: [] }
      })
    })

    expect(rowRenders.size).toBe(0)
    expect(screen.getByText('Alpha')).toBeTruthy()
  })
})
