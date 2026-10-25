/**
 * Changed-files card: file list + inline review pane; header opens the
 * Status-column Changes tab when `openOverviewReview` is wired (D-01).
 * Rows open review on click — no hover peek (that card was noise).
 */
import { useCallback, useState } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCodeOutlineRegular,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { ChangesTurnData } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import {
  diffHunkFromWorkspaceFileDiff,
} from './workspace-file-diff-hunk.ts'
import { ChangesReviewView } from './ChangesReviewView.tsx'
import type { LoadFileDiff } from './load-file-diff.ts'
import css from './ChangedFiles.module.css'

export { diffHunkFromWorkspaceFileDiff } from './workspace-file-diff-hunk.ts'
export type { LoadFileDiff } from './load-file-diff.ts'

const COLLAPSED_ROWS = 3
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
 * Render one turn's changed files. Header + rows open the Status Changes tab
 * when `openOverviewReview` is wired (D-01); otherwise rows open an inline
 * review pane.
 */
export function ChangedFiles({
  changes, loadFileDiff, openFile, openOverviewReview, t,
}: {
  changes: ChangesTurnData
  loadFileDiff: LoadFileDiff
  openFile: (path: string) => void
  /** Open Status-column Changes tab (persistent). Header prefers this when set. */
  openOverviewReview?: (index: number) => void
} & PropsLocale<typeof NS>) {
  const [expanded, setExpanded] = useState(false)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)

  const reviewing = reviewIndex !== null
  const safeIndex =
    reviewing && changes.files[reviewIndex] !== undefined ? reviewIndex : 0

  const openReview = useCallback((index: number) => {
    if (openOverviewReview !== undefined) {
      openOverviewReview(index)
      return
    }
    setReviewIndex(index)
  }, [openOverviewReview])

  const onHeaderClick = useCallback(() => {
    if (openOverviewReview !== undefined) {
      openOverviewReview(0)
      return
    }
    setReviewIndex((prev) => (prev === null ? 0 : null))
  }, [openOverviewReview])

  const foldable = changes.files.length > COLLAPSED_ROWS
  const rows = foldable && !expanded ? changes.files.slice(0, COLLAPSED_ROWS) : changes.files

  return <div className={css.card} data-changed-files data-review-open={reviewing ? 'true' : undefined}>
    <button type="button" className={css.header} aria-label={t('changes.openReview')}
      aria-expanded={openOverviewReview !== undefined ? undefined : reviewing}
      onClick={onHeaderClick}>
      <span className={css.tile}><IconCodeOutlineRegular size={18} /></span>
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
      {expanded ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
    </button>}
    {reviewing
      ? (
        <ChangesReviewView
          changes={changes}
          fileIndex={safeIndex}
          onFileIndex={openReview}
          loadFileDiff={loadFileDiff}
          openFile={openFile}
          t={t}
        />
      )
      : null}
  </div>
}
