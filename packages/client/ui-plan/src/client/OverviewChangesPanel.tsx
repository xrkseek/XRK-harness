/**
 * Status-column Changes review tab — persistent counterpart to the turn-tail
 * ChangedFiles card (D-01). Does not import ui-deliverables; mirrors its
 * DiffBlock + fileDiff wire via inject.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  DiffBlock,
  IconChevronDownOutline14,
  Menu,
} from '@xrkseek/client-ui-primitives'
import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'
import type { TranslateNS } from '@xrkseek/client-ui-slots'
import type { PlanKey } from './locales.ts'
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
  added, deleted, t,
}: {
  added: number
  deleted: number
  t: PlanTranslate
}) {
  return <>
    <span className={css.added}>{t('preview.changes.added', { count: GROUPED.format(added) })}</span>
    <span className={css.deleted}>{t('preview.changes.deleted', { count: GROUPED.format(deleted) })}</span>
  </>
}

function diffHunk(diff: WorkspaceFileDiff): { path: string; oldText: string | null; newText: string } | null {
  if (diff.kind !== 'text') return null
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const body = line.slice(1)
      if (line.startsWith('-')) oldLines.push(body)
      else if (line.startsWith('+')) newLines.push(body)
      else {
        oldLines.push(body)
        newLines.push(body)
      }
    }
  }
  return {
    path: diff.path,
    oldText: diff.before
      ? `${oldLines.join('\n')}${oldLines.length > 0 ? '\n' : ''}`
      : null,
    newText: diff.after
      ? `${newLines.join('\n')}${newLines.length > 0 ? '\n' : ''}`
      : '',
  }
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
  const [fileIndex, setFileIndex] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [diff, setDiff] = useState<WorkspaceFileDiff | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (focus !== null) {
      setSeq(focus.seq)
      setFileIndex(focus.index)
    }
  }, [focus?.revision])

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

  const hunk = diff !== undefined && diff !== null ? diffHunk(diff) : null
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
      <div className={css.meta}>
        <span>{t('preview.changes.turn', { turn: activeTurn.turnId })}</span>
        <span className={css.stat}>
          <Counts t={t} added={activeTurn.added} deleted={activeTurn.deleted} />
        </span>
        {turns.length > 1
          ? (
            <label className={css.turnPick}>
              <span className={css.visuallyHidden}>{t('preview.changes.selectTurn')}</span>
              <select
                value={String(activeTurn.seq)}
                aria-label={t('preview.changes.selectTurn')}
                onChange={(event) => {
                  setSeq(Number(event.currentTarget.value))
                  setFileIndex(0)
                }}
              >
                {turns.map((row) => (
                  <option key={row.seq} value={row.seq}>
                    {t('preview.changes.turnOption', {
                      turn: row.turnId,
                      count: String(row.total),
                    })}
                  </option>
                ))}
              </select>
            </label>
          )
          : null}
      </div>
      {activeFile === undefined
        ? <div className={css.empty}>{t('preview.changes.unavailable')}</div>
        : (
          <>
            <div className={css.reviewBar}>
              <Menu
                className={css.selector}
                open={menuOpen}
                dense
                align="start"
                onClose={() => { setMenuOpen(false) }}
                selectedId={String(safeIndex)}
                onSelect={(id) => {
                  setFileIndex(Number(id))
                  setMenuOpen(false)
                }}
                items={activeTurn.files.map((entry, at) => ({
                  id: String(at),
                  label: (
                    <span className={css.menuItem}>
                      <span className={css.menuPath}>{entry.display}</span>
                      <span className={css.menuCounts}>
                        {entry.binary === true ? t('preview.changes.binary')
                          : entry.oversized === true ? t('preview.changes.oversized')
                            : <Counts t={t} added={entry.added} deleted={entry.deleted} />}
                      </span>
                    </span>
                  ),
                }))}
                anchor={
                  <button
                    type="button"
                    className={css.selectorButton}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label={t('preview.changes.selectFile')}
                    title={activeFile.display}
                    data-review-file={activeFile.path}
                    onClick={() => { setMenuOpen((value) => !value) }}
                  >
                    <span className={css.selectorPath}>{activeFile.display}</span>
                    <IconChevronDownOutline14 />
                  </button>
                }
              />
              <span className={css.reviewCounts}>
                {activeFile.binary === true ? t('preview.changes.binary')
                  : activeFile.oversized === true ? t('preview.changes.oversized')
                    : <Counts t={t} added={activeFile.added} deleted={activeFile.deleted} />}
              </span>
            </div>
            {diff === undefined && <span className={css.status}>{t('preview.changes.loading')}</span>}
            {error !== undefined && <span className={css.status} data-error="true">{error}</span>}
            {diff === null && error === undefined && (
              <span className={css.status}>{t('preview.changes.unavailable')}</span>
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
          </>
        )}
    </div>
  )
}
