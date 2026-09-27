/**
 * Changed-files card: file list + one dedicated review pane with a file
 * selector (DSH ReviewTab navigation shape; no right-sidebar tab — see
 * docs/sidebar-workbench.md).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  DiffBlock,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCodeOutline16,
  Menu,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'
import type { ChangesTurnData } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import {
  diffHunkFromWorkspaceFileDiff,
} from './workspace-file-diff-hunk.ts'
import css from './ChangedFiles.module.css'

export { diffHunkFromWorkspaceFileDiff } from './workspace-file-diff-hunk.ts'

const COLLAPSED_ROWS = 3
const GROUPED = new Intl.NumberFormat('en-US')

function Counts({
  added, deleted, t,
}: { added: number; deleted: number } & PropsLocale<typeof NS>) {
  return <>
    <span className={css.added}>{t('changes.added', { count: GROUPED.format(added) })}</span>
    <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(deleted) })}</span>
  </>
}

export type LoadFileDiff = (
  seq: number,
  index: number,
  signal: AbortSignal,
) => Promise<WorkspaceFileDiff | null>

/**
 * Render one turn's changed files. Opening review shows a single pane with a
 * file selector Menu (thick file navigation); DiffBlock keeps unified/split.
 */
export function ChangedFiles({
  changes, loadFileDiff, openFile, t,
}: {
  changes: ChangesTurnData
  loadFileDiff: LoadFileDiff
  openFile: (path: string) => void
} & PropsLocale<typeof NS>) {
  const [expanded, setExpanded] = useState(false)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [diff, setDiff] = useState<WorkspaceFileDiff | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const reviewing = reviewIndex !== null
  const safeIndex =
    reviewing && changes.files[reviewIndex] !== undefined ? reviewIndex : 0
  const activeFile = reviewing ? changes.files[safeIndex] : undefined

  useEffect(() => {
    if (!reviewing) {
      setDiff(undefined)
      setError(undefined)
      setMenuOpen(false)
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
  }, [reviewing, safeIndex, changes.seq, loadFileDiff])

  const openReview = useCallback((index: number) => {
    setReviewIndex(index)
  }, [])

  const toggleReview = useCallback(() => {
    setReviewIndex((prev) => (prev === null ? 0 : null))
  }, [])

  const foldable = changes.files.length > COLLAPSED_ROWS
  const rows = foldable && !expanded ? changes.files.slice(0, COLLAPSED_ROWS) : changes.files
  const hunk = diff !== undefined && diff !== null ? diffHunkFromWorkspaceFileDiff(diff) : null

  return <div className={css.card} data-changed-files data-review-open={reviewing ? 'true' : undefined}>
    <button type="button" className={css.header} aria-label={t('changes.openReview')}
      aria-expanded={reviewing}
      onClick={toggleReview}>
      <span className={css.tile}><IconCodeOutline16 size={18} /></span>
      <span className={css.titles}>
        <span className={css.title}>{t('changes.title', { count: String(changes.total) })}</span>
        <span className={css.stat}><Counts t={t} added={changes.added} deleted={changes.deleted} /></span>
      </span>
    </button>
    <ul className={css.list}>
      {rows.map((file, index) => (
        <li key={`${file.display}:${index}`}>
          <button type="button"
            className={css.row}
            data-selected={reviewing && safeIndex === index ? 'true' : undefined}
            title={file.path}
            aria-pressed={reviewing && safeIndex === index}
            aria-label={t('changes.viewDiff', { name: file.display })}
            onClick={() => { openReview(index) }}>
            <span className={css.path}>{file.display}</span>
            <span className={css.counts}>
              {file.binary === true ? t('changes.binary')
                : file.oversized === true ? t('changes.oversized')
                  : <Counts t={t} added={file.added} deleted={file.deleted} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
    {foldable && <button type="button" className={css.toggle}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'changes.collapseAria' : 'changes.expandAria', { count: String(changes.files.length) })}
      onClick={() => { setExpanded(value => !value) }}>
      <span>{t(expanded ? 'changes.collapse' : 'changes.all', { count: String(changes.files.length) })}</span>
      {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
    </button>}
    {reviewing && activeFile !== undefined && (
      <div className={css.review} data-changes-review>
        <div className={css.reviewBar}>
          <Menu
            className={css.selector}
            open={menuOpen}
            dense
            align="start"
            onClose={() => { setMenuOpen(false) }}
            selectedId={String(safeIndex)}
            onSelect={(id) => {
              openReview(Number(id))
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
          <span className={css.reviewStatus}>{t('changes.unavailable')}</span>
        )}
        {diff?.kind === 'binary' && <span className={css.reviewStatus}>{t('changes.binary')}</span>}
        {diff?.kind === 'oversized' && <span className={css.reviewStatus}>{t('changes.oversized')}</span>}
        {hunk !== null && <>
          <DiffBlock diffs={[hunk]} className={css.diff} layout="split" />
          <button type="button" className={css.openFile}
            onClick={() => { openFile(activeFile.path) }}>
            {t('changes.previewFile', { name: activeFile.display })}
          </button>
        </>}
      </div>
    )}
  </div>
}
