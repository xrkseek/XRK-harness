/**
 * Archived-session Settings page: the registry-global archive set joined with
 * the loaded Session summaries, newest archive first, filtered by one search
 * box, with per-row and bulk Unarchive / permanent Delete. An archive entry
 * whose Session is gone has no row and no action; the set itself stays host-owned.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, IconSearchOutlineRegular, Modal } from '@xrkseek/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { SessionId } from '@xrkseek/client-runtime/client'
import { relativeTime } from './tree.ts'
import css from './ArchivedSessionsSection.module.css'

/** Registration-side face used by the page. */
export interface ArchivedSessionsSectionInjected {
  /**
   * Restore one archived Session.
   * @param sessionId - Session to unarchive.
   */
  unarchive: (sessionId: SessionId) => Promise<void>
  /**
   * Permanently delete one archived Session (durable log).
   * @param sessionId - Session to delete.
   */
  deleteSession: (sessionId: SessionId) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type ArchivedSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archivedSessions'>
  & InjectFace<ArchivedSessionsSectionInjected>

type Translate = ArchivedSessionsSectionProps['t']

/** One archived Session as the page renders it. */
interface ArchivedRow {
  id: SessionId
  title: string
  /** Owning Workspace title, or the ungrouped label for a Session outside every Workspace. */
  workspace: string
  updatedAt: number
}

type DeletePlan =
  | { readonly kind: 'one'; readonly row: ArchivedRow }
  | { readonly kind: 'many'; readonly rows: readonly ArchivedRow[] }

/** Localized compact relative time of one row's last activity. */
function timeLabel(updatedAt: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Whether one row matches the normalized query in its title or Workspace label. */
function matches(row: ArchivedRow, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0
    || row.title.toLowerCase().includes(normalizedQuery)
    || row.workspace.toLowerCase().includes(normalizedQuery)
}

async function runAll(
  ids: readonly SessionId[],
  action: (sessionId: SessionId) => Promise<void>,
): Promise<string | null> {
  const failures: string[] = []
  for (const id of ids) {
    try {
      await action(id)
    } catch (reason: unknown) {
      failures.push(reason instanceof Error ? reason.message : String(reason))
    }
  }
  if (failures.length === 0) return null
  return failures[0] ?? null
}

/**
 * Render the archived-session page.
 * @param props - composed slot props (see {@link ArchivedSessionsSectionProps}).
 * @returns the settings page element tree.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const { t, unarchive, deleteSession, useSessions, useWorkspaces } = props
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const ungrouped = t('ungrouped')
  const summaries = sessions.byId

  // Archive order is oldest first; the page lists the most recently archived
  // Session first. A member with no loaded summary is not addressable here.
  const rows = useMemo<ArchivedRow[]>(() => {
    const owners = new Map<string, string>()
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owners.set(id, workspace.title)
    }
    // Archived sessions are filtered out of workspace.sessionIds; fall back to
    // cwd→path matching so the Settings row still names the owning workspace.
    return [...archivedSessionIds].reverse().flatMap((id) => {
      const summary = summaries[id]
      if (summary === undefined) return []
      let workspace = owners.get(id) ?? ungrouped
      if (workspace === ungrouped && summary.cwd !== undefined) {
        const match = workspaces.find(item => item.path === summary.cwd)
        if (match !== undefined) workspace = match.title
      }
      return [{
        id,
        title: summary.displayTitle,
        workspace,
        updatedAt: summary.updatedAt,
      }]
    })
  }, [archivedSessionIds, workspaces, summaries, ungrouped])

  const now = Date.now()
  const visible = rows.filter(row => matches(row, query.trim().toLowerCase()))
  const visibleIds = useMemo(() => new Set(visible.map(row => row.id)), [visible])
  const selectedVisible = useMemo(
    () => visible.filter(row => selected.has(row.id)),
    [visible, selected],
  )
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length
  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected

  // Drop selection for rows that left the archive / filter set.
  useEffect(() => {
    setSelected((prev) => {
      let changed = false
      const next = new Set<SessionId>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [visibleIds])

  if (sessions.phase !== 'ready') return <p className={css.status}>{t('loading')}</p>

  const archived = archivedSessionIds.length > 0

  const toggleOne = (id: SessionId, on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAllVisible = (on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const row of visible) {
        if (on) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }

  const closeDelete = (): void => {
    if (busy) return
    setDeletePlan(null)
    setActionError(null)
  }

  const confirmDelete = (): void => {
    if (busy || deletePlan === null) return
    const targets = deletePlan.kind === 'one' ? [deletePlan.row] : [...deletePlan.rows]
    if (targets.length === 0) return
    setBusy(true)
    setActionError(null)
    void runAll(targets.map(row => row.id), deleteSession).then((error) => {
      setBusy(false)
      if (error !== null) {
        setActionError(error)
        return
      }
      setSelected((prev) => {
        const next = new Set(prev)
        for (const row of targets) next.delete(row.id)
        return next
      })
      setDeletePlan(null)
    })
  }

  const bulkUnarchive = (): void => {
    if (busy || selectedVisible.length === 0) return
    setBusy(true)
    setActionError(null)
    const targets = selectedVisible.map(row => row.id)
    void runAll(targets, unarchive).then((error) => {
      setBusy(false)
      if (error !== null) {
        setActionError(error)
        return
      }
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of targets) next.delete(id)
        return next
      })
    })
  }

  const deleteModalTitle = deletePlan?.kind === 'many'
    ? t('delete.bulkTitle')
    : t('delete.title')
  const deleteModalDescription = deletePlan === null
    ? undefined
    : deletePlan.kind === 'one'
      ? t('delete.desc', { title: deletePlan.row.title })
      : t('delete.bulkDesc', { n: deletePlan.rows.length })

  return (
    <div className={css.section}>
      <p className={css.hint}>{t('storageHint')}</p>
      <div className={css.search}>
        <IconSearchOutlineRegular aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </div>
      {visible.length > 0 ? (
        <div className={css.toolbar} role="toolbar" aria-label={t('bulk.toolbar')}>
          <label className={css.checkLabel}>
            <input
              type="checkbox"
              className={css.check}
              checked={allVisibleSelected}
              ref={(node) => {
                if (node) node.indeterminate = someVisibleSelected
              }}
              disabled={busy}
              aria-label={t('bulk.selectAll')}
              onChange={(event) => { toggleAllVisible(event.currentTarget.checked) }}
            />
            <span className={css.toolbarCount}>
              {selectedVisible.length > 0
                ? t('bulk.selected', { n: selectedVisible.length })
                : t('bulk.selectAll')}
            </span>
          </label>
          <span className={css.toolbarActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || selectedVisible.length === 0}
              onClick={bulkUnarchive}
            >
              {t('bulk.unarchive')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={css.deleteAction}
              disabled={busy || selectedVisible.length === 0}
              onClick={() => {
                setActionError(null)
                setDeletePlan({ kind: 'many', rows: selectedVisible })
              }}
            >
              {t('bulk.delete')}
            </Button>
          </span>
        </div>
      ) : null}
      {actionError !== null && deletePlan === null ? (
        <div className={css.deleteError} role="alert">{actionError}</div>
      ) : null}
      {!archived ? <p className={css.status}>{t('empty')}</p> : null}
      {archived && rows.length === 0 ? <p className={css.status}>{t('unavailable')}</p> : null}
      {rows.length > 0 && visible.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
      {visible.length > 0 ? (
        <ul className={css.list}>
          {visible.map(row => {
            const checked = selected.has(row.id)
            return (
              <li key={row.id} className={css.row} data-selected={checked ? 'true' : undefined}>
                <label className={css.rowCheck}>
                  <input
                    type="checkbox"
                    className={css.check}
                    checked={checked}
                    disabled={busy}
                    aria-label={t('bulk.selectNamed', { title: row.title })}
                    onChange={(event) => { toggleOne(row.id, event.currentTarget.checked) }}
                  />
                </label>
                <span className={css.identity}>
                  <span className={css.title}>{row.title}</span>
                  <span className={css.meta}>
                    {[row.workspace, timeLabel(row.updatedAt, now, t)].join(' · ')}
                  </span>
                </span>
                <span className={css.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={t('unarchiveNamed', { title: row.title })}
                    onClick={() => {
                      setActionError(null)
                      unarchive(row.id).catch((reason: unknown) => {
                        setActionError(
                          reason instanceof Error ? reason.message : String(reason),
                        )
                      })
                    }}
                  >
                    {t('unarchive')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={css.deleteAction}
                    disabled={busy}
                    aria-label={t('deleteNamed', { title: row.title })}
                    onClick={() => {
                      setActionError(null)
                      setDeletePlan({ kind: 'one', row })
                    }}
                  >
                    {t('delete')}
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
      <Modal
        open={deletePlan !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={deleteModalTitle}
        {...deleteModalDescription === undefined
          ? {}
          : { description: deleteModalDescription }}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={busy}
              onClick={confirmDelete}
            >
              {t('delete')}
            </Button>
          </>
        )}
      >
        {busy ? <div className={css.deleteStatus} role="status">{t('delete.pending')}</div> : null}
        {actionError !== null && deletePlan !== null ? (
          <div className={css.deleteError} role="alert">{actionError}</div>
        ) : null}
      </Modal>
    </div>
  )
}
