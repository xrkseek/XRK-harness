/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFillRegular, IconPersonalizationOutlineRegular,
  IconProjectAddOutlineRegular, IconSearchOutlineRegular, IconUsersOutlineRegular,
  Menu, Modal, Tooltip,
} from '@xrkseek/client-ui-primitives'
import {
  WorkspaceArchiveActiveError,
  type SessionId, type SessionSearchResultItem,
  type WorkspaceId, type WorkspaceView,
} from '@xrkseek/client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import {
  deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY,
  type ArchiveViewMode, type SessionListFacts, type SessionNode, type SessionOrderBy,
} from './tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { DEFAULT_SIDEBAR_SPLIT_RATIO, FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import { TeamRoster } from './TeamRoster.tsx'
import { AddAgentPanel } from './AddAgentPanel.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5
/** Matches AppFrame phone inset stamp — avoid value-importing ui-layout. */
const PHONE_LAYOUT_ATTR = 'data-xrk-layout-phone'

type PhoneSidebarLane = 'workspaces' | 'agents'

function subscribePhoneShell(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [PHONE_LAYOUT_ATTR],
  })
  return () => { obs.disconnect() }
}

function readPhoneShell(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.hasAttribute(PHONE_LAYOUT_ATTR)
}

/** True when AppFrame is in phone overlay mode (drawer, not desktop rail). */
function usePhoneShell(): boolean {
  return useSyncExternalStore(subscribePhoneShell, readPhoneShell, () => false)
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  const ordered: SessionId[] = []
  const included = new Set<string>()
  for (const key of stored) {
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/**
 * Equality for the sidebar's list-facts slice: exactly the three fields the
 * tree derivation reads. `jobsBySession` / `subagentsByParent` /
 * `currentAddress` / `phase` ride the same snapshot at chat frequency and must
 * not invalidate the derivation (or every row memo behind it).
 */
function sameSessionListFacts(a: SessionListFacts, b: SessionListFacts): boolean {
  return a.ids === b.ids && a.byId === b.byId && a.current === b.current
}

/**
 * Read the derivation slice of the global session list.
 * @param useSessions - the slot's standard list hook.
 * @returns the three list facts {@link deriveGroups} / {@link deriveFlat} /
 * {@link deriveSearchResults} consume, stable while those fields are stable.
 */
function useSessionListFacts(useSessions: WorkspaceBrowserProps['useSessions']): SessionListFacts {
  return useSessions(
    (state): SessionListFacts => ({ ids: state.ids, byId: state.byId, current: state.current }),
    sameSessionListFacts,
  )
}

/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListFacts['byId']): number {
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
  return a < b ? -1 : 1
}

/** Reconcile one editable order account and apply its activity-promotion policy. */
function nextSessionOrderAccount({
  sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency,
}: {
  sessionIds: readonly SessionId[]
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  list: SessionListFacts
  orderBy: SessionOrderBy
  sortByRecency: boolean
}): { order: SessionId[]; updatedAt: Record<string, number>; changed: boolean } {
  let order = reconciledSessionOrder(sessionIds, previousOrder)
  if (sortByRecency) {
    order.sort((a, b) => compareSessionRecency(a, b, list.byId))
  } else if (orderBy === 'updated') {
    const promoted = sessionIds
      .filter((id) => {
        const session = list.byId[id]
        return session !== undefined
          && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
      })
      .sort((a, b) => compareSessionRecency(a, b, list.byId))
    if (promoted.length > 0) {
      const promotedIds = new Set(promoted)
      order = [...promoted, ...order.filter(id => !promotedIds.has(id))]
    }
  }
  const updatedAt: Record<string, number> = {}
  for (const id of sessionIds) {
    const session = list.byId[id]
    if (session !== undefined) updatedAt[id] = session.updatedAt
  }
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({
  groupBy, orderBy, archiveMode, onGroupPick, onOrderPick, onArchivePick, t,
}: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  archiveMode: ArchiveViewMode
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  onArchivePick: (mode: ArchiveViewMode) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
        { type: 'separator' as const, id: 'archive-separator' },
        { type: 'label' as const, id: 'archive-view', text: t('archiveView.label') },
        { id: 'archive-hidden', label: t('archiveView.hidden') },
        { id: 'archive-all', label: t('archiveView.all') },
        { id: 'archive-only', label: t('archiveView.archivedOnly') },
      ]}
      selectedIds={[
        groupBy,
        orderBy,
        archiveMode === 'hidden'
          ? 'archive-hidden'
          : archiveMode === 'all'
            ? 'archive-all'
            : 'archive-only',
      ]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'archive-hidden') onArchivePick('hidden')
        else if (id === 'archive-all') onArchivePick('all')
        else if (id === 'archive-only') onArchivePick('archived-only')
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom">
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutlineRegular />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  workspaces: readonly WorkspaceView[]
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows unless archiveMode shows them). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Registry-global pin order (newest first). */
  pinnedSessionIds: readonly SessionNode['id'][]
  /** Registry-global workspace pin order (newest first). */
  pinnedWorkspaceIds: readonly WorkspaceId[]
  /** Client-local archive filter. */
  archiveMode: ArchiveViewMode
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Pin or unpin a session (row menu action). */
  onSessionPinToggle: (sessionId: SessionNode['id'], pinned: boolean) => void
  /** Pin or unpin a workspace (row menu / pin button). */
  onWorkspacePinToggle: (workspaceId: WorkspaceId, pinned: boolean) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
  /** Host account home; POSIX Workspace hover paths may display as `~`. */
  home?: string | undefined
  /**
   * When false, omit the 未分组 bucket. Project pane keeps this false —
   * orphans live under 干员工作区 only.
   */
  includeUngrouped?: boolean
  /**
   * Sessions owned by the other pane (e.g. project workspace membership when
   * deriving the 干员 tree). Must not appear as 未分组 orphans.
   */
  excludeFromUngrouped?: ReadonlySet<SessionId>
  /** When false, omit the empty-tree copy (干员 pane uses its own empty banner). */
  showEmpty?: boolean
}

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({
  useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, pinnedSessionIds,
  pinnedWorkspaceIds, archiveMode,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, onSessionPinToggle,
  onWorkspacePinToggle,
  insertWorkspaceBefore, insertSessionBefore, orderBy,
  groupExpansion, setGroupExpanded,
  sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder,
  home, t,
  includeUngrouped = true,
  excludeFromUngrouped,
  showEmpty = true,
}: SessionTreeProps) {
  const list = useSessionListFacts(useSessions)
  const phase = useSessions(s => s.phase)
  const current = list.current
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  /**
   * Mirror of {@link drag} for the row handlers. Those must keep one identity
   * per row (a fresh closure per row per render defeats every row memo), so
   * they read the live gesture from the ref instead of closing over state.
   * Written only by {@link applyDrag} — never during render.
   */
  const dragRef = useRef<DragState | null>(null)
  const applyDrag = useCallback((next: DragState | null): void => {
    dragRef.current = next
    setDrag(next)
  }, [])
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  /** Live workspace gesture for the stable row handlers; see {@link dragRef}. */
  const workspaceDragRef = useRef<WorkspaceDragState | null>(null)
  const applyWorkspaceDrag = useCallback((next: WorkspaceDragState | null): void => {
    workspaceDragRef.current = next
    setWorkspaceDrag(next)
  }, [])
  const workspaceDropCommitted = useRef(false)
  const previousOrderBy = useRef(orderBy)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
      ?? UNGROUPED_KEY
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const expandedGroups = useMemo(
    () => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key),
    [groupExpansion],
  )
  const ungroupedSessionIds = useMemo(() => {
    if (!includeUngrouped) return [] as SessionId[]
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    if (excludeFromUngrouped) {
      for (const id of excludeFromUngrouped) accounted.add(id)
    }
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [excludeFromUngrouped, includeUngrouped, list, workspaces])
  useEffect(() => {
    if (phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const accounts = [
      ...workspaces.map(workspace => ({
        key: workspace.workspaceId as string,
        sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
      })),
      ...(includeUngrouped
        ? [{ key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds }]
        : []),
    ]
    for (const { key, sessionIds } of accounts) {
      const previousOrder = sessionOrderByAccount[key]
      const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder,
        previousUpdatedAt,
        list,
        orderBy,
        sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [includeUngrouped, list, phase, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces])
  const orderedWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
  }, [sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(
    () => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]),
    [sessionOrderByAccount, ungroupedSessionIds],
  )
  const groups = useMemo(() => {
    const derived = deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
      expandedGroups,
      ...(includeUngrouped && sessionOrderByAccount[UNGROUPED_KEY] !== undefined
        ? { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }
        : {}),
      ...(excludeFromUngrouped !== undefined
        ? { excludeFromUngrouped }
        : {}),
    }, archiveMode, pinnedSessionIds, pinnedWorkspaceIds)
    return includeUngrouped
      ? derived
      : derived.filter(group => group.key !== UNGROUPED_KEY)
  }, [
    list, orderedWorkspaces, archivedSessionIds, archiveMode, pinnedSessionIds,
    pinnedWorkspaceIds, expandedGroups, sessionOrderByAccount, includeUngrouped,
    excludeFromUngrouped,
  ])
  /**
   * Relative-time clock for the rows: one read per derivation change instead of
   * a render-time `Date.now()`. A fresh value per render would invalidate every
   * row memo (and every row's time label would still only change on a re-render,
   * exactly as before — no timer is introduced here).
   */
  const now = useMemo(() => Date.now(), [groups])
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    applyDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    const targetIndex = group.sessions.findIndex(session => session.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined
      ? group.sessions.length
      : group.sessions.findIndex(session => session.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? orderedUngroupedSessionIds
      : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  /**
   * Latest-commit mirror for the row handlers. The commit functions close over
   * the derived groups and orders, so they change on every list update; the row
   * handlers must not (a new `drag` closure per row per render defeats every row
   * memo). Effects run before the next pointer event, so the ref is current when
   * a drop lands.
   */
  const commitSessionDragRef = useRef<(
    activeDrag: DragState, over: NonNullable<DragState['over']>
  ) => void>(() => {})
  useEffect(() => {
    commitSessionDragRef.current = commitSessionDrag
  })
  const startSessionDrag = useCallback((accountKey: string, sessionId: SessionNode['id']): void => {
    sessionDropCommitted.current = false
    applyDrag({ accountKey, sessionId, over: null })
  }, [applyDrag])
  const hoverSessionDrag = useCallback((sessionId: SessionNode['id'], half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
    const active = dragRef.current
    if (active === null) return
    applyDrag({ ...active, over: { id: sessionId, half } })
  }, [applyDrag])
  const dropSessionDrag = useCallback((sessionId: SessionNode['id'], half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
    const active = dragRef.current
    if (active === null) return
    commitSessionDragRef.current(active, { id: sessionId, half })
  }, [])
  const endSessionDrag = useCallback((): void => {
    const active = dragRef.current
    if (active?.over !== null && active?.over !== undefined) commitSessionDragRef.current(active, active.over)
    else applyDrag(null)
    sessionDropCommitted.current = false
  }, [applyDrag])
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    applyWorkspaceDrag(null)
    const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? workspaces.length
      : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  /** Workspace-row counterpart of {@link commitSessionDragRef}. */
  const commitWorkspaceDragRef = useRef<(
    activeDrag: WorkspaceDragState, over: NonNullable<WorkspaceDragState['over']>
  ) => void>(() => {})
  useEffect(() => {
    commitWorkspaceDragRef.current = commitWorkspaceDrag
  })
  const startWorkspaceDrag = useCallback((workspaceId: WorkspaceId): void => {
    workspaceDropCommitted.current = false
    applyWorkspaceDrag({ workspaceId, over: null })
  }, [applyWorkspaceDrag])
  /** Move the insert marker onto another Workspace row (long-press reorder). */
  const markWorkspaceDrag = useCallback((overId: string, half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: Rows arms hover only after its long-press starts this drag. */
    const active = workspaceDragRef.current
    if (active === null) return
    applyWorkspaceDrag({ ...active, over: { id: overId as WorkspaceId, half } })
  }, [applyWorkspaceDrag])
  const endWorkspaceDrag = useCallback((): void => {
    const active = workspaceDragRef.current
    if (active?.over !== null && active?.over !== undefined) commitWorkspaceDragRef.current(active, active.over)
    else applyWorkspaceDrag(null)
    workspaceDropCommitted.current = false
  }, [applyWorkspaceDrag])
  const dropWorkspace = useCallback((workspaceId: WorkspaceId, half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: the section's onDrop is mounted only while a workspace drag is live. */
    const active = workspaceDragRef.current
    if (active === null) return
    commitWorkspaceDragRef.current(active, { id: workspaceId, half })
  }, [])
  const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === groups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
      >
        {showEmpty && groups.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {groups.map((group) => {
          const workspaceId = group.workspaceId
          const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
            ? workspaceDrag.over.half
            : null
          // Row-stable handlers behind a per-render object: the row memo compares
          // the object's facts (present/absent), never the closure identity.
          const workspaceDragProps = workspaceId === undefined ? undefined : {
            start: () => { startWorkspaceDrag(workspaceId) },
            hover: markWorkspaceDrag,
            end: endWorkspaceDrag,
          }
          return (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room is the section's own margin
          // (WorkspaceBrowser.module.css).
            <div
              key={group.key}
              className={clsx(
                css.groupSection,
                workspaceMarker === 'before' && css.workspaceDropBefore,
                workspaceMarker === 'after' && css.workspaceDropAfter,
              )}
              data-workspace-id={workspaceId}
              onDragOver={workspaceDrag === null || workspaceId === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  markWorkspaceDrag(workspaceId, workspaceGroupHalf(e))
                }}
              onDrop={workspaceDrag === null || workspaceId === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  dropWorkspace(workspaceId, workspaceGroupHalf(e))
                }}
            >
              <ProjectRowItem
                group={group}
                home={home}
                t={t}
                onToggle={() => {
                  if (group.expanded) {
                    setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                  }
                  setGroupExpanded(group.key, !group.expanded)
                }}
                onCreate={() => {
                  if (group.workspaceId !== undefined) {
                    setGroupExpanded(group.key, true)
                    startSession(group.workspaceId)
                  }
                }}
                drag={workspaceDragProps}
                actions={group.workspaceId === undefined
                  ? undefined
                  : {
                    rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                    },
                    pinToggle: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) {
                        onWorkspacePinToggle(group.workspaceId, group.pinned)
                      }
                    },
                    delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                    },
                  }}
              />
              {(expandedSessionGroups.includes(group.key)
                ? group.sessions
                : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
              ).map((node) => {
              // Session drag never leaves its group. Ungrouped writes only the
              // browser-local account; real Workspaces may also write Host order.
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                // Per-render object over row-stable handlers; the row memo reads
                // `active` / `marker` as facts and never the closure identity.
                const dragProps = {
                  start: () => { startSessionDrag(group.key, node.id) },
                  active: sameGroupDrag,
                  marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                  hover: (half: 'before' | 'after') => { hoverSessionDrag(node.id, half) },
                  drop: (half: 'before' | 'after') => { dropSessionDrag(node.id, half) },
                  end: endSessionDrag,
                }
                return (
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    currentId={current}
                    now={now}
                    onOpen={open}
                    onRename={onSessionRename}
                    onFork={forkSession}
                    onArchive={onSessionArchive}
                    onPinToggle={onSessionPinToggle}
                    drag={dragProps}
                    t={t}
                  />
                )
              })}
              {group.sessions.length > COLLAPSED_SESSION_LIMIT && (
                <button
                  type="button"
                  className={css.sessionOverflowButton}
                  aria-expanded={expandedSessionGroups.includes(group.key)}
                  onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
                >
                  {expandedSessionGroups.includes(group.key)
                    ? t('sessions.collapse')
                    : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  useSessions, open, forkSession, onSessionRename, onSessionArchive, onSessionPinToggle,
  archivedSessionIds, pinnedSessionIds, archiveMode,
  orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
  excludeSessionIds,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'onSessionPinToggle'
  | 'archivedSessionIds'
  | 'pinnedSessionIds'
  | 'archiveMode'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 't'
> & {
  /** Sessions belonging to agent-home workspaces (lower pane) — omit from flat. */
  excludeSessionIds?: ReadonlySet<SessionId>
}) {
  const list = useSessionListFacts(useSessions)
  const phase = useSessions(s => s.phase)
  const baseRows = useMemo(() => {
    const rows = deriveFlat(list, archivedSessionIds, archiveMode, pinnedSessionIds)
    if (!excludeSessionIds || excludeSessionIds.size === 0) return rows
    return rows.filter(row => !excludeSessionIds.has(row.id))
  }, [list, archivedSessionIds, archiveMode, pinnedSessionIds, excludeSessionIds])
  const sessionIds = useMemo(() => baseRows.map(row => row.id), [baseRows])
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (phase !== 'ready') return
    const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const next = nextSessionOrderAccount({
      sessionIds,
      previousOrder,
      previousUpdatedAt,
      list,
      orderBy,
      sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
    })
    if (next.changed) {
      syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id as string), next.updatedAt)
    }
  }, [list, phase, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
  const rows = useMemo(() => {
    const byId = new Map(baseRows.map(row => [row.id, row]))
    return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })
  }, [baseRows, sessionOrderByAccount, sessionIds])
  const [drag, setDrag] = useState<DragState | null>(null)
  /** Live gesture for the stable row handlers; see the tree's {@link dragRef}. */
  const dragRef = useRef<DragState | null>(null)
  const applyDrag = useCallback((next: DragState | null): void => {
    dragRef.current = next
    setDrag(next)
  }, [])
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    applyDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  /** Latest-commit mirror for the row handlers (see the tree's `commitSessionDragRef`). */
  const commitDragRef = useRef<(activeDrag: DragState, over: NonNullable<DragState['over']>) => void>(() => {})
  useEffect(() => {
    commitDragRef.current = commitDrag
  })
  const startRowDrag = useCallback((sessionId: SessionNode['id']): void => {
    dropCommitted.current = false
    applyDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId, over: null })
  }, [applyDrag])
  const hoverRowDrag = useCallback((sessionId: SessionNode['id'], half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
    const active = dragRef.current
    if (active === null) return
    applyDrag({ ...active, over: { id: sessionId, half } })
  }, [applyDrag])
  const dropRowDrag = useCallback((sessionId: SessionNode['id'], half: 'before' | 'after'): void => {
    /* v8 ignore next 2 -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
    const active = dragRef.current
    if (active === null) return
    commitDragRef.current(active, { id: sessionId, half })
  }, [])
  const endRowDrag = useCallback((): void => {
    const active = dragRef.current
    if (active?.over !== null && active?.over !== undefined) commitDragRef.current(active, active.over)
    else applyDrag(null)
    dropCommitted.current = false
  }, [applyDrag])
  /** One clock read per row recomputation; see the tree's `now`. */
  const now = useMemo(() => Date.now(), [rows])
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map((node) => {
          const active = drag !== null
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={list.current}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              onPinToggle={onSessionPinToggle}
              flat
              drag={{
                start: () => { startRowDrag(node.id) },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: half => { hoverRowDrag(node.id, half) },
                drop: half => { dropRowDrag(node.id, half) },
                end: endRowDrag,
              }}
              t={t}
            />
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  archiveMode,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  archiveMode: ArchiveViewMode
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const list = useSessionListFacts(useSessions)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(
      list, workspaces, query, archivedSessionIds, currentRemote, resultLimit, archiveMode,
    ),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit, archiveMode],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  pinSession,
  unpinSession,
  pinWorkspace,
  unpinWorkspace,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostDescription,
  renderSlot,
  t,
  listTeam,
  upsertTeamMember,
  removeTeamMember,
  exportTeamMember,
  importTeamPack,
}: WorkspaceBrowserProps) {
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const pinnedWorkspaceIds = useWorkspaces(state => state.pinnedWorkspaceIds)
  const currentSessionId = useSessions(state => state.current)
  const teamAvailable = listTeam !== undefined
    && upsertTeamMember !== undefined
  const [teamOpen, setTeamOpen] = useState(false)
  const [addAgentOpen, setAddAgentOpen] = useState(false)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const home = useHostDescription(info => info?.home)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const archiveMode = useStore(s => s.archiveMode)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const splitRatio = useStore(s => s.splitRatio ?? DEFAULT_SIDEBAR_SPLIT_RATIO)
  const phoneShell = usePhoneShell()
  const [phoneLane, setPhoneLane] = useState<PhoneSidebarLane>('workspaces')
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [agentSearchExpanded, setAgentSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const normalizedAgentQuery = sanitizeSearchQuery(agentQuery).trim().toLowerCase()
  const agentSearchRoot = useRef<HTMLDivElement>(null)
  const agentSearchInput = useRef<HTMLInputElement>(null)
  const projectWorkspaces = useMemo(
    () => workspaces.filter(row => row.kind !== 'agent-home'),
    [workspaces],
  )
  const agentWorkspacesAll = useMemo(
    () => workspaces.filter(row => row.kind === 'agent-home' && Boolean(row.boundMemberId)),
    [workspaces],
  )
  const agentWorkspaces = useMemo(() => {
    if (normalizedAgentQuery === '') return agentWorkspacesAll
    return agentWorkspacesAll.filter((row) => {
      const title = row.title.toLowerCase()
      const member = (row.boundMemberId ?? '').toLowerCase()
      return title.includes(normalizedAgentQuery) || member.includes(normalizedAgentQuery)
    })
  }, [agentWorkspacesAll, normalizedAgentQuery])
  const agentSessionIds = useMemo(() => {
    const ids = new Set<SessionId>()
    for (const row of agentWorkspacesAll) {
      for (const id of row.sessionIds) ids.add(id)
    }
    return ids
  }, [agentWorkspacesAll])
  const projectSessionIds = useMemo(() => {
    const ids = new Set<SessionId>()
    for (const row of projectWorkspaces) {
      for (const id of row.sessionIds) ids.add(id)
    }
    return ids
  }, [projectWorkspaces])
  const splitColumnRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<{ startY: number; startRatio: number } | null>(null)
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId as string),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded])

  useEffect(() => {
    if (!wide || !agentSearchExpanded) return
    agentSearchInput.current?.focus({ preventScroll: true })
  }, [wide, agentSearchExpanded])

  useEffect(() => {
    if (!wide || !agentSearchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || agentSearchRoot.current?.contains(event.target) === true) return
      agentSearchInput.current?.blur()
      if (normalizedAgentQuery !== '') return
      setAgentSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedAgentQuery, wide, agentSearchExpanded])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  // Row callbacks are identity-stable: every row memo compares them, so a new
  // closure per parent render would re-render the whole list.
  const onSessionRename = useCallback((sessionId: SessionNode['id'], currentTitle: string): void => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }, [])

  // Idle archive stays one-shot. Host refuses with session-active while a
  // turn / job / subagent is live — confirm then retry with force:true.
  type ArchiveActivity = { kind: string; id: string; title: string }
  const [archiveTarget, setArchiveTarget] = useState<{
    sessionId: SessionId
    activity: readonly ArchiveActivity[]
  } | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const closeArchive = () => {
    if (archiving) return
    setArchiveTarget(null)
    setArchiveError(null)
  }
  const confirmArchiveForce = () => {
    if (archiving || archiveTarget === null) return
    setArchiving(true)
    setArchiveError(null)
    archiveSession(archiveTarget.sessionId, { force: true }).then(() => {
      setArchiving(false)
      setArchiveTarget(null)
    }).catch((reason: unknown) => {
      setArchiving(false)
      setArchiveError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionArchive = useCallback((sessionId: SessionNode['id']): void => {
    archiveSession(sessionId).catch((reason: unknown) => {
      if (reason instanceof WorkspaceArchiveActiveError) {
        setArchiveTarget({
          sessionId,
          activity: reason.rpcError.details.activity,
        })
        setArchiveError(null)
        return
      }
      console.warn('session archive rejected:', reason)
    })
  }, [archiveSession])
  const onSessionPinToggle = useCallback((sessionId: SessionNode['id'], pinned: boolean): void => {
    ;(pinned ? unpinSession : pinSession)(sessionId).catch((reason: unknown) => {
      console.warn('session pin rejected:', reason)
    })
  }, [pinSession, unpinSession])
  const onWorkspacePinToggle = useCallback((workspaceId: WorkspaceId, pinned: boolean): void => {
    ;(pinned ? unpinWorkspace : pinWorkspace)(workspaceId).catch((reason: unknown) => {
      console.warn('workspace pin rejected:', reason)
    })
  }, [pinWorkspace, unpinWorkspace])

  // Fork can take a while on large logs (Host seed + open). Keep a simple
  // blocking chrome so the sidebar stays responsive to the eye.
  const [forking, setForking] = useState(false)
  /**
   * Re-entrancy gate as a ref: the callback feeds every row's `onFork`, and a
   * `forking` state dependency would hand the rows a new closure on each start
   * (and an older one could re-enter while the overlay is up).
   */
  const forkingRef = useRef(false)
  const runFork = useCallback((sessionId: SessionId): void => {
    if (forkingRef.current) return
    forkingRef.current = true
    setForking(true)
    void Promise.resolve(forkSession(sessionId)).finally(() => {
      forkingRef.current = false
      setForking(false)
    })
  }, [forkSession])

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{
    workspaceId: WorkspaceId
    title: string
    kind?: 'project' | 'agent-home'
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Dialog openers handed to the memoized workspace rows (stable identities).
  const onWorkspaceRenameRequest = useCallback((workspaceId: WorkspaceId, currentTitle: string): void => {
    setRenameTarget({ workspaceId, currentTitle })
    setRenameDraft(currentTitle)
    setRenameError(null)
  }, [])
  const onWorkspaceDeleteRequest = useCallback((workspaceId: WorkspaceId, title: string): void => {
    const kind = workspaces.find(row => row.workspaceId === workspaceId)?.kind
    setDeleteTarget({
      workspaceId,
      title,
      ...(kind === 'agent-home' || kind === 'project' ? { kind } : {}),
    })
    setDeleteError(null)
  }, [workspaces])

  const openTeamRoster = useCallback((): void => {
    if (!teamAvailable) return
    if (currentSessionId === undefined) startSession()
    setTeamOpen(true)
  }, [teamAvailable, currentSessionId, startSession])

  const openAddAgent = useCallback((): void => {
    if (!teamAvailable) return
    if (currentSessionId === undefined) startSession()
    setAddAgentOpen(true)
  }, [teamAvailable, currentSessionId, startSession])

  const boundMemberIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of workspaces) {
      if (row.kind === 'agent-home' && row.boundMemberId) {
        ids.add(row.boundMemberId)
      }
    }
    return ids
  }, [workspaces])

  const workspaceTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of workspaces) {
      map.set(row.workspaceId, row.title)
    }
    return map
  }, [workspaces])

  const onSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const column = splitColumnRef.current
    if (!column) return
    event.preventDefault()
    splitDragRef.current = { startY: event.clientY, startRatio: splitRatio }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [splitRatio])

  const onSplitPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = splitDragRef.current
    const column = splitColumnRef.current
    if (!drag || !column) return
    const height = column.getBoundingClientRect().height
    if (height <= 0) return
    const next = drag.startRatio + (event.clientY - drag.startY) / height
    actions.setSplitRatio(next)
  }, [actions])

  const onSplitPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    splitDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onSplitKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      actions.setSplitRatio(splitRatio - 0.03)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      actions.setSplitRatio(splitRatio + 0.03)
    }
  }, [actions, splitRatio])

  const projectList = wide && (normalizedQuery !== ''
    ? (
      <SearchResults
        useSessions={useSessions}
        open={open}
        workspaces={projectWorkspaces}
        archivedSessionIds={archivedSessionIds}
        archiveMode={archiveMode}
        query={normalizedQuery}
        remote={remoteSearch}
        resultLimit={searchResultLimit}
        t={t}
      />
    )
    : groupBy === 'flat'
      ? (
        <FlatList
          useSessions={useSessions} open={open} forkSession={runFork}
          onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
          onSessionPinToggle={onSessionPinToggle}
          archivedSessionIds={archivedSessionIds}
          pinnedSessionIds={pinnedSessionIds}
          archiveMode={archiveMode}
          orderBy={orderBy}
          sessionOrderByAccount={sessionOrderByAccount}
          sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
          syncSessionOrderAccount={actions.syncSessionOrderAccount}
          setSessionOrder={actions.setSessionOrder}
          excludeSessionIds={agentSessionIds}
          t={t}
        />
      )
      : (
        <SessionTree
          useSessions={useSessions}
          onSessionRename={onSessionRename}
          onSessionArchive={onSessionArchive}
          onSessionPinToggle={onSessionPinToggle}
          forkSession={runFork}
          workspaces={projectWorkspaces}
          groupExpansion={groupExpansion}
          setGroupExpanded={actions.setGroupExpanded}
          sessionOrderByAccount={sessionOrderByAccount}
          sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
          syncSessionOrderAccount={actions.syncSessionOrderAccount}
          setSessionOrder={actions.setSessionOrder}
          archivedSessionIds={archivedSessionIds}
          pinnedSessionIds={pinnedSessionIds}
          pinnedWorkspaceIds={pinnedWorkspaceIds}
          archiveMode={archiveMode}
          startSession={startSession}
          open={open}
          insertWorkspaceBefore={insertWorkspaceBefore}
          insertSessionBefore={insertSessionBefore}
          orderBy={orderBy}
          home={home}
          t={t}
          onRenameRequest={onWorkspaceRenameRequest}
          onDeleteRequest={onWorkspaceDeleteRequest}
          onWorkspacePinToggle={onWorkspacePinToggle}
          includeUngrouped={false}
        />
      ))

  const agentList = wide && (
    normalizedAgentQuery !== '' && agentWorkspaces.length === 0
      ? (
        <div className={css.agentEmpty}>{t('search.noMatches')}</div>
      )
      : (
        <>
          {agentWorkspacesAll.length === 0
            ? (
              <div className={css.agentEmpty}>
                <span className={css.agentEmptyTitle}>{t('agent.empty')}</span>
                <span>{t('agent.emptyHint')}</span>
              </div>
            )
            : null}
          <SessionTree
            useSessions={useSessions}
            onSessionRename={onSessionRename}
            onSessionArchive={onSessionArchive}
            onSessionPinToggle={onSessionPinToggle}
            forkSession={runFork}
            workspaces={agentWorkspaces}
            groupExpansion={groupExpansion}
            setGroupExpanded={actions.setGroupExpanded}
            sessionOrderByAccount={sessionOrderByAccount}
            sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
            syncSessionOrderAccount={actions.syncSessionOrderAccount}
            setSessionOrder={actions.setSessionOrder}
            archivedSessionIds={archivedSessionIds}
            pinnedSessionIds={pinnedSessionIds}
            pinnedWorkspaceIds={pinnedWorkspaceIds}
            archiveMode={archiveMode}
            startSession={startSession}
            open={open}
            insertWorkspaceBefore={insertWorkspaceBefore}
            insertSessionBefore={insertSessionBefore}
            orderBy={orderBy}
            home={home}
            t={t}
            onRenameRequest={onWorkspaceRenameRequest}
            onDeleteRequest={onWorkspaceDeleteRequest}
            onWorkspacePinToggle={onWorkspacePinToggle}
            includeUngrouped
            excludeFromUngrouped={projectSessionIds}
            showEmpty={false}
          />
        </>
      )
  )

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      {/* Rail: search + add workspace only (split is wide-only). */}
      {!wide && (
        <>
          <div className={css.search}>
            <Tooltip label={t('search')}>
              <button
                type="button"
                className={css.searchButton}
                aria-label={t('search.sessions.aria')}
                onClick={() => {
                  setSearchExpanded(true)
                  setSearchOnExpand(true)
                  expandSidebar()
                }}
              >
                <IconSearchOutlineRegular size={18} />
              </button>
            </Tooltip>
          </div>
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutlineRegular size={18} />
              </button>
            </Tooltip>
          )}
        </>
      )}

      {wide && (
        <div
          className={css.splitColumn}
          ref={splitColumnRef}
          {...(phoneShell ? { 'data-phone-lane': phoneLane } : {})}
        >
          {phoneShell ? (
            <div className={css.phoneLaneTabs} role="tablist" aria-label={t('splitter.aria')}>
              <button
                type="button"
                role="tab"
                className={css.phoneLaneTab}
                aria-selected={phoneLane === 'workspaces'}
                onClick={() => { setPhoneLane('workspaces') }}
              >
                {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
              </button>
              <button
                type="button"
                role="tab"
                className={css.phoneLaneTab}
                aria-selected={phoneLane === 'agents'}
                onClick={() => { setPhoneLane('agents') }}
              >
                {t('section.agents')}
              </button>
            </div>
          ) : null}
          <div
            className={clsx(css.splitPane, css.splitPaneUpper)}
            data-phone-pane="workspaces"
            style={phoneShell
              ? undefined
              : { flex: `0 0 ${Math.round(splitRatio * 1000) / 10}%` }}
          >
            <div className={css.sectionHeader} data-phone-section-chrome="">
              <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
                {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
              </span>
              <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
                <div
                  ref={searchRoot}
                  className={clsx(css.search, searchExpanded && css.searchExpanded)}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                    searchInput.current?.focus()
                  }}
                >
                  <Tooltip label={t('search')} side="bottom" disabled={searchExpanded}>
                    <button
                      type="button"
                      className={css.searchButton}
                      aria-label={t('search.sessions.aria')}
                      aria-expanded={searchExpanded}
                      onClick={() => {
                        setWsPickerOpen(false)
                        setSearchExpanded(true)
                      }}
                    >
                      <IconSearchOutlineRegular size={searchExpanded ? 11 : 14} />
                    </button>
                  </Tooltip>
                  <input
                    ref={searchInput}
                    className={css.searchInput}
                    type="text"
                    placeholder={t('search.placeholder')}
                    maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                    value={query}
                    tabIndex={searchExpanded ? 0 : -1}
                    onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape') return
                      setQuery('')
                      setSearchExpanded(false)
                    }}
                  />
                  {searchExpanded && (
                    <button
                      type="button"
                      className={css.clearButton}
                      aria-label={t('search.clear')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setQuery('')
                        setSearchExpanded(false)
                      }}
                    >
                      <IconCloseFillRegular />
                    </button>
                  )}
                </div>
              </div>
              <div className={clsx(css.headerActions, searchExpanded && css.headerActionsHidden)}>
                <ViewOptionsMenu
                  groupBy={groupBy}
                  orderBy={orderBy}
                  archiveMode={archiveMode}
                  onGroupPick={(mode) => { actions.setGroupBy(mode) }}
                  onOrderPick={(mode) => { actions.setOrderBy(mode) }}
                  onArchivePick={(mode) => { actions.setArchiveMode(mode) }}
                  t={t}
                />
                {teamAvailable && (
                  <Tooltip label={t('team.title')} side="bottom">
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('team.title')}
                      onClick={openTeamRoster}
                    >
                      <IconUsersOutlineRegular size={16} />
                    </button>
                  </Tooltip>
                )}
                {directoryFlowAvailable && (
                  <Tooltip label={t('workspace.add')} side="bottom">
                    <button
                      ref={wsPlusRef}
                      type="button"
                      className={css.iconButton}
                      aria-label={t('workspace.add')}
                      onClick={() => { setWsPickerOpen(v => !v) }}
                    >
                      <IconProjectAddOutlineRegular size={16} />
                    </button>
                  </Tooltip>
                )}
              </div>
              <WorkspacePickFlow
                t={t}
                open={wsPickerOpen}
                anchorRef={wsPlusRef}
                useWorkspaces={useWorkspaces}
                createWorkspace={createWorkspace}
                useDirectoryFlow={useDirectoryFlow}
                renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
                addOnly
                side="right"
                onPick={(workspaceId) => {
                  setWsPickerOpen(false)
                  startSession(workspaceId)
                }}
                onClose={() => { setWsPickerOpen(false) }}
              />
            </div>
            <div className={css.listArea} data-pane="project">{projectList}</div>
          </div>

          {phoneShell ? null : (
            <button
              type="button"
              className={css.splitHandle}
              aria-label={t('splitter.aria')}
              aria-orientation="horizontal"
              aria-valuemin={15}
              aria-valuemax={85}
              aria-valuenow={Math.round(splitRatio * 100)}
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
              onKeyDown={onSplitKeyDown}
            />
          )}

          <div
            className={clsx(css.splitPane, css.splitPaneLower)}
            data-phone-pane="agents"
          >
            <div className={css.sectionHeader} data-phone-section-chrome="">
              <span className={clsx(css.sectionLabel, css.wide, agentSearchExpanded && css.sectionLabelHidden)}>
                {t('section.agents')}
              </span>
              <div className={clsx(css.searchSlot, agentSearchExpanded && css.searchSlotExpanded)}>
                <div
                  ref={agentSearchRoot}
                  className={clsx(css.search, agentSearchExpanded && css.searchExpanded)}
                  onClick={() => {
                    setAgentSearchExpanded(true)
                    agentSearchInput.current?.focus()
                  }}
                >
                  <Tooltip label={t('search')} side="bottom" disabled={agentSearchExpanded}>
                    <button
                      type="button"
                      className={css.searchButton}
                      aria-label={t('search.agents.aria')}
                      aria-expanded={agentSearchExpanded}
                      onClick={() => { setAgentSearchExpanded(true) }}
                    >
                      <IconSearchOutlineRegular size={agentSearchExpanded ? 11 : 14} />
                    </button>
                  </Tooltip>
                  <input
                    ref={agentSearchInput}
                    className={css.searchInput}
                    type="text"
                    placeholder={t('search.agents.placeholder')}
                    maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                    value={agentQuery}
                    tabIndex={agentSearchExpanded ? 0 : -1}
                    onChange={(e) => { setAgentQuery(sanitizeSearchQuery(e.target.value)) }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape') return
                      setAgentQuery('')
                      setAgentSearchExpanded(false)
                    }}
                  />
                  {agentSearchExpanded && (
                    <button
                      type="button"
                      className={css.clearButton}
                      aria-label={t('search.clear')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setAgentQuery('')
                        setAgentSearchExpanded(false)
                      }}
                    >
                      <IconCloseFillRegular />
                    </button>
                  )}
                </div>
              </div>
              <div className={clsx(css.headerActions, agentSearchExpanded && css.headerActionsHidden)}>
                <ViewOptionsMenu
                  groupBy={groupBy}
                  orderBy={orderBy}
                  archiveMode={archiveMode}
                  onGroupPick={(mode) => { actions.setGroupBy(mode) }}
                  onOrderPick={(mode) => { actions.setOrderBy(mode) }}
                  onArchivePick={(mode) => { actions.setArchiveMode(mode) }}
                  t={t}
                />
                {teamAvailable && (
                  <Tooltip label={t('agent.addWorkspace')} side="bottom">
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('agent.addWorkspace')}
                      onClick={openAddAgent}
                    >
                      <IconProjectAddOutlineRegular size={16} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
            <div className={css.listArea} data-pane="agents">{agentList}</div>
          </div>
        </div>
      )}

      {!wide && (
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      )}

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : {
              description: t(
                deleteTarget.kind === 'agent-home' ? 'delete.descAgentHome' : 'delete.desc',
                { name: deleteTarget.title },
              ),
            }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
      <Modal
        open={archiveTarget !== null}
        onClose={closeArchive}
        closeLabel={t('close')}
        title={t('archive.active.title')}
        {...archiveTarget === null
          ? {}
          : { description: t('archive.active.desc') }}
        footer={(
          <>
            <Button variant="outline" disabled={archiving} onClick={closeArchive}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={archiving}
              onClick={confirmArchiveForce}
            >
              {t('archive.active.confirm')}
            </Button>
          </>
        )}
      >
        {archiveTarget !== null && (
          <ul className={css.archiveActivityList}>
            {archiveTarget.activity.map((item) => {
              const kindKey = item.kind === 'turn' || item.kind === 'job' || item.kind === 'subagent'
                ? (`archive.active.kind.${item.kind}` as const)
                : null
              return (
                <li key={`${item.kind}:${item.id}`}>
                  <span className={css.archiveActivityKind}>
                    {kindKey !== null ? t(kindKey) : item.kind}
                  </span>
                  {' · '}
                  {item.title}
                </li>
              )
            })}
          </ul>
        )}
        {archiving && <div className={css.deleteStatus} role="status">{t('archive.active.pending')}</div>}
        {archiveError !== null && <div className={css.renameError} role="alert">{archiveError}</div>}
      </Modal>
      {teamAvailable && listTeam && upsertTeamMember && (
        <>
          <TeamRoster
            open={teamOpen}
            onClose={() => { setTeamOpen(false) }}
            sessionId={currentSessionId}
            t={t}
            useWorkspaces={useWorkspaces}
            createWorkspace={createWorkspace}
            useDirectoryFlow={useDirectoryFlow}
            renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
            startSession={startSession}
            listTeam={listTeam}
            upsertTeamMember={upsertTeamMember}
            removeTeamMember={removeTeamMember}
            exportTeamMember={exportTeamMember}
            importTeamPack={importTeamPack}
          />
          <AddAgentPanel
            open={addAgentOpen}
            onClose={() => { setAddAgentOpen(false) }}
            sessionId={currentSessionId}
            t={t}
            boundMemberIds={boundMemberIds}
            workspaceTitleById={workspaceTitleById}
            listTeam={listTeam}
            upsertTeamMember={upsertTeamMember}
            startSession={startSession}
            onOpenTeam={() => { setAddAgentOpen(false); setTeamOpen(true) }}
          />
        </>
      )}
      {forking && (
        <div className={css.forkOverlay} role="status" aria-live="polite" aria-busy="true">
          <span className={css.forkSpinner} aria-hidden="true" />
          <span className={css.forkLabel}>{t('fork.pending')}</span>
        </div>
      )}
    </div>
  )
}
