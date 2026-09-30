/**
 * Status-column Changes review — persistent counterpart to the turn-tail
 * ChangedFiles card (D-01). Does not import ui-deliverables; shares the
 * DiffHunk transform via ui-primitives.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  DiffBlock,
  IconChevronDownOutline14,
  Menu,
  diffHunkFromWorkspaceFileDiff,
} from '@xrkseek/client-ui-primitives'
import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'
import type { TranslateNS } from '@xrkseek/client-ui-slots'
import css from './OverviewChangesPanel.module.css'

type PlanTranslate = TranslateNS<'plan'>

const GROUPED = new Intl.NumberFormat('en-US')

export type OverviewChangesFile = {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

export type OverviewChangesTurn = {
  readonly seq: number
  readonly turnId: string
  readonly files: readonly OverviewChangesFile[]
  readonly total: number
  readonly added: number
  readonly deleted: number
}

type Focus = {
  readonly sessionId: string
  readonly seq: number
  readonly index: number
  readonly revision: number
}

type ChangesReviewFace = {
  getSnapshot: () => Focus | null
  subscribe: (listener: () => void) => () => void
}

function Counts({
  added,
  deleted,
  t,
}: {
  added: number
  deleted: number
  t: PlanTranslate
}): ReactNode {
  return (
    <>
      {added > 0
        ? <span className={css.added}>{t('preview.changes.added', { count: GROUPED.format(added) })}</span>
        : null}
      {deleted > 0
        ? <span className={css.deleted}>{t('preview.changes.deleted', { count: GROUPED.format(deleted) })}</span>
        : null}
      {added <= 0 && deleted <= 0
        ? <span className={css.added}>{t('preview.changes.added', { count: '0' })}</span>
        : null}
    </>
  )
}

function fileStatusLabel(
  file: Pick<OverviewChangesFile, 'added' | 'deleted' | 'binary' | 'oversized'>,
  t: PlanTranslate,
): ReactNode {
  if (file.binary === true) return t('preview.changes.binary')
  if (file.oversized === true) return t('preview.changes.oversized')
  return <Counts t={t} added={file.added} deleted={file.deleted} />
}

/** Shared pill trigger for turn / file pick menus (theme-safe, not native select). */
function PickTrigger({
  open,
  label,
  title,
  ariaLabel,
  onClick,
  reviewFile,
}: {
  open: boolean
  label: ReactNode
  title?: string
  ariaLabel: string
  onClick: () => void
  reviewFile?: string
}): ReactNode {
  return (
    <button
      type="button"
      className={css.pickTrigger}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      {...(reviewFile !== undefined ? { 'data-review-file': reviewFile } : {})}
    >
      <span className={css.pickLabel}>{label}</span>
      <IconChevronDownOutline14 className={css.pickChevron} data-open={open ? '' : undefined} />
    </button>
  )
}

function MenuRow({
  primary,
  secondary,
}: {
  primary: ReactNode
  secondary: ReactNode
}): ReactNode {
  return (
    <span className={css.menuItem}>
      <span className={css.menuPrimary}>{primary}</span>
      <span className={css.menuSecondary}>{secondary}</span>
    </span>
  )
}

/**
 * Latest workspaceChanges turn + optional focus from `ctx.changesReview`.
 */
export function OverviewChangesPanel({
  sessionId,
  turns,
  focusFace,
  loadFileDiff,
  openFile,
  t,
}: {
  sessionId: string
  turns: readonly OverviewChangesTurn[]
  focusFace?: ChangesReviewFace
  loadFileDiff: (
    seq: number,
    index: number,
    signal: AbortSignal,
  ) => Promise<WorkspaceFileDiff | null>
  openFile: (path: string) => void
  t: PlanTranslate
}) {
  const focus = useSyncExternalStore(
    (onStoreChange) => focusFace?.subscribe(onStoreChange) ?? (() => {}),
    () => {
      const next = focusFace?.getSnapshot() ?? null
      return next !== null && next.sessionId === sessionId ? next : null
    },
    () => null,
  )

  const [seq, setSeq] = useState<number | undefined>(undefined)
  const [pinned, setPinned] = useState(false)
  const [fileIndex, setFileIndex] = useState(0)
  const [turnMenuOpen, setTurnMenuOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [diff, setDiff] = useState<WorkspaceFileDiff | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (focus !== null) {
      setSeq(focus.seq)
      setFileIndex(focus.index)
      setPinned(true)
    }
  }, [focus?.revision])

  useEffect(() => {
    if (pinned) return
    const latest = turns[turns.length - 1]
    if (latest !== undefined) setSeq(latest.seq)
  }, [turns, pinned])

  const activeTurn = turns.find((row) => row.seq === seq) ?? turns[turns.length - 1]
  const safeIndex = activeTurn !== undefined && activeTurn.files[fileIndex] !== undefined
    ? fileIndex
    : 0
  const activeFile = activeTurn?.files[safeIndex]

  useEffect(() => {
    if (activeTurn === undefined || activeFile === undefined) {
      setDiff(undefined)
      setError(undefined)
      return
    }
    const ac = new AbortController()
    setDiff(undefined)
    setError(undefined)
    void loadFileDiff(activeTurn.seq, safeIndex, ac.signal).then(
      (value) => {
        if (!ac.signal.aborted) setDiff(value)
      },
      (err: unknown) => {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
          setDiff(null)
        }
      },
    )
    return () => { ac.abort() }
  }, [activeTurn?.seq, safeIndex, activeFile, loadFileDiff])

  if (turns.length === 0 || activeTurn === undefined) {
    return <div className={css.empty}>{t('preview.changes.empty')}</div>
  }

  const hunk = diff !== undefined && diff !== null
    ? diffHunkFromWorkspaceFileDiff(diff)
    : null
  const textNote = diff?.kind === 'text'
    ? (!diff.before
      ? 'preview.changes.created' as const
      : !diff.after
        ? 'preview.changes.deletedNote' as const
        : diff.hunks.length === 0
          ? 'preview.changes.unchanged' as const
          : undefined)
    : undefined
  const showDiff = hunk !== null && diff?.kind === 'text' && diff.hunks.length > 0

  return (
    <div className={css.root} data-overview-changes data-changes-review>
      <header className={css.toolbar}>
        <div className={css.toolbarMain}>
          {turns.length > 1
            ? (
              <Menu
                className={css.pick}
                open={turnMenuOpen}
                dense
                compact
                portal
                align="start"
                onClose={() => { setTurnMenuOpen(false) }}
                selectedId={String(activeTurn.seq)}
                onSelect={(id) => {
                  setPinned(true)
                  setSeq(Number(id))
                  setFileIndex(0)
                  setTurnMenuOpen(false)
                  setFileMenuOpen(false)
                }}
                items={turns.map((row) => ({
                  id: String(row.seq),
                  label: (
                    <MenuRow
                      primary={row.turnId}
                      secondary={t('preview.changes.fileCount', { count: String(row.total) })}
                    />
                  ),
                }))}
                anchor={
                  <PickTrigger
                    open={turnMenuOpen}
                    ariaLabel={t('preview.changes.selectTurn')}
                    title={activeTurn.turnId}
                    label={t('preview.changes.turn', { turn: activeTurn.turnId })}
                    onClick={() => {
                      setTurnMenuOpen((v) => !v)
                      setFileMenuOpen(false)
                    }}
                  />
                }
              />
            )
            : (
              <span className={css.turnOnly}>
                {t('preview.changes.turn', { turn: activeTurn.turnId })}
              </span>
            )}
          <span className={css.stat} aria-label={t('preview.changes.turn', { turn: activeTurn.turnId })}>
            <Counts t={t} added={activeTurn.added} deleted={activeTurn.deleted} />
          </span>
        </div>
      </header>

      {activeFile === undefined
        ? <div className={css.empty}>{t('preview.changes.unavailable')}</div>
        : (
          <div className={css.body}>
            <div className={css.fileRow}>
              <Menu
                className={css.pick}
                open={fileMenuOpen}
                dense
                compact
                portal
                align="start"
                onClose={() => { setFileMenuOpen(false) }}
                selectedId={String(safeIndex)}
                onSelect={(id) => {
                  setFileIndex(Number(id))
                  setFileMenuOpen(false)
                }}
                items={activeTurn.files.map((entry, at) => ({
                  id: String(at),
                  label: (
                    <MenuRow
                      primary={entry.display}
                      secondary={fileStatusLabel(entry, t)}
                    />
                  ),
                }))}
                anchor={
                  <PickTrigger
                    open={fileMenuOpen}
                    ariaLabel={t('preview.changes.selectFile')}
                    title={activeFile.display}
                    label={activeFile.display}
                    reviewFile={activeFile.path}
                    onClick={() => {
                      setFileMenuOpen((v) => !v)
                      setTurnMenuOpen(false)
                    }}
                  />
                }
              />
              <span className={css.fileCounts}>
                {fileStatusLabel(activeFile, t)}
              </span>
            </div>

            {diff === undefined && <span className={css.status}>{t('preview.changes.loading')}</span>}
            {error !== undefined && <span className={css.status} data-error="true">{error}</span>}
            {diff === null && error === undefined && (
              <span className={css.status}>{t('preview.changes.missing')}</span>
            )}
            {diff?.kind === 'binary' && <span className={css.status}>{t('preview.changes.binary')}</span>}
            {diff?.kind === 'oversized' && <span className={css.status}>{t('preview.changes.oversized')}</span>}
            {textNote !== undefined
              ? <p className={css.note} role="note">{t(textNote)}</p>
              : null}
            {showDiff && hunk !== null
              ? <DiffBlock diffs={[hunk]} className={css.diff} layout="split" />
              : null}
            <button
              type="button"
              className={css.openFile}
              onClick={() => { openFile(activeFile.path) }}
            >
              {t('preview.changes.previewFile', { name: activeFile.display })}
            </button>
          </div>
        )}
    </div>
  )
}
