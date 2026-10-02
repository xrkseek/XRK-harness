/**
 * Persistent changes review body: file selector + DiffBlock.
 * Shared by the turn-tail inline pane and the Status-column Changes tab.
 */
import { useEffect, useState } from 'react'
import {
  DiffBlock,
  IconChevronDownOutline14,
  Menu,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'
import type { ChangesTurnData } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import { diffHunkFromWorkspaceFileDiff } from './workspace-file-diff-hunk.ts'
import type { LoadFileDiff } from './load-file-diff.ts'
import css from './ChangedFiles.module.css'

const GROUPED = new Intl.NumberFormat('en-US')

function Counts({
  added, deleted, t,
}: { added: number; deleted: number } & PropsLocale<typeof NS>) {
  return <>
    {added > 0 ? <span className={css.added}>{t('changes.added', { count: GROUPED.format(added) })}</span> : null}
    {deleted > 0 ? <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(deleted) })}</span> : null}
    {added <= 0 && deleted <= 0
      ? <span className={css.added}>{t('changes.added', { count: '0' })}</span>
      : null}
  </>
}

/**
 * Always-open review surface for one turn's changed files.
 * @param props.fileIndex - selected file; clamped when out of range.
 */
export function ChangesReviewView({
  changes,
  fileIndex,
  onFileIndex,
  loadFileDiff,
  openFile,
  t,
}: {
  changes: ChangesTurnData
  fileIndex: number
  onFileIndex: (index: number) => void
  loadFileDiff: LoadFileDiff
  openFile: (path: string) => void
} & PropsLocale<typeof NS>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [diff, setDiff] = useState<WorkspaceFileDiff | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const safeIndex = changes.files[fileIndex] !== undefined ? fileIndex : 0
  const activeFile = changes.files[safeIndex]

  useEffect(() => {
    if (activeFile === undefined) {
      setDiff(undefined)
      setError(undefined)
      return
    }
    const ac = new AbortController()
    setDiff(undefined)
    setError(undefined)
    void loadFileDiff(changes.seq, safeIndex, ac.signal).then(
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
  }, [activeFile, safeIndex, changes.seq, loadFileDiff])

  if (activeFile === undefined) {
    return <div className={css.reviewStatus} data-changes-review>{t('changes.unavailable')}</div>
  }

  const hunk = diff !== undefined && diff !== null ? diffHunkFromWorkspaceFileDiff(diff) : null
  const textNote = diff?.kind === 'text'
    ? (!diff.before
      ? 'diff.created' as const
      : !diff.after
        ? 'diff.deleted' as const
        : diff.hunks.length === 0
          ? 'diff.unchanged' as const
          : undefined)
    : undefined
  const showDiff = hunk !== null && diff?.kind === 'text' && diff.hunks.length > 0

  return (
    <div className={css.review} data-changes-review data-review-state={diff === undefined ? 'loading' : 'ready'}>
      <div className={css.reviewBar}>
        <Menu
          className={css.selector}
          open={menuOpen}
          dense
          align="start"
          onClose={() => { setMenuOpen(false) }}
          selectedId={String(safeIndex)}
          onSelect={(id) => {
            onFileIndex(Number(id))
            setMenuOpen(false)
          }}
          items={changes.files.map((entry, at) => ({
            id: String(at),
            label: (
              <span className={css.menuItem}>
                <span className={css.menuPath}>{entry.display}</span>
                <span className={css.menuCounts}>
                  {entry.binary === true ? t('changes.binary')
                    : entry.oversized === true ? t('changes.oversized')
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
              aria-label={t('changes.selectFile')}
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
          {activeFile.binary === true ? t('changes.binary')
            : activeFile.oversized === true ? t('changes.oversized')
              : <Counts t={t} added={activeFile.added} deleted={activeFile.deleted} />}
        </span>
      </div>
      {diff === undefined && <span className={css.reviewStatus}>{t('changes.loading')}</span>}
      {error !== undefined && <span className={css.reviewStatus} data-error="true">{error}</span>}
      {diff === null && error === undefined && (
        <span className={css.reviewStatus}>{t('changes.missing')}</span>
      )}
      {diff?.kind === 'binary' && <span className={css.reviewStatus}>{t('changes.binary')}</span>}
      {diff?.kind === 'oversized' && <span className={css.reviewStatus}>{t('changes.oversized')}</span>}
      {textNote !== undefined
        ? <p className={css.diffNote} role="note">{t(textNote)}</p>
        : null}
      {showDiff && hunk !== null
        ? <DiffBlock diffs={[hunk]} className={css.diff} layout="split" hidePath />
        : null}
      <button type="button" className={css.openFile}
        onClick={() => { openFile(activeFile.path) }}>
        {t('changes.previewFile', { name: activeFile.display })}
      </button>
    </div>
  )
}
