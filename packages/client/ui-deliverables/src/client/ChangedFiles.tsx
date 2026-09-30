/**
 * Changed-files card: file list + inline review pane; header opens the
 * Status-column Changes tab when `openOverviewReview` is wired (D-01).
 * Rows also hover-preview via HoverCard + fileDiff.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  DiffBlock,
  HoverCard,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCodeOutline16,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'
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
const HOVER_PREVIEW_DELAY_MS = 500

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

/** Mounted only while its HoverCard is open — avoids loading every row on pass. */
function ChangedFilePreview({
  seq,
  index,
  display,
  loadFileDiff,
  t,
}: {
  seq: number
  index: number
  display: string
  loadFileDiff: LoadFileDiff
} & PropsLocale<typeof NS>) {
  const [diff, setDiff] = useState<WorkspaceFileDiff | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const ac = new AbortController()
    setDiff(undefined)
    setError(undefined)
    void loadFileDiff(seq, index, ac.signal).then(
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
  }, [seq, index, loadFileDiff])

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
  // Note-only for empty/unchanged; skip path-only DiffBlock stub (D-05).
  const showDiff = hunk !== null && diff?.kind === 'text' && diff.hunks.length > 0

  return (
    <div className={css.preview} data-changes-hover-preview>
      <div className={css.previewPath} data-changes-preview-path>{display}</div>
      {diff === undefined && <span className={css.previewStatus}>{t('changes.loading')}</span>}
      {error !== undefined && <span className={css.previewStatus} data-error="true">{error}</span>}
      {diff === null && error === undefined && (
        <span className={css.previewStatus}>{t('changes.missing')}</span>
      )}
      {diff?.kind === 'binary' && <span className={css.previewStatus}>{t('changes.binary')}</span>}
      {diff?.kind === 'oversized' && <span className={css.previewStatus}>{t('changes.oversized')}</span>}
      {textNote !== undefined
        ? <p className={css.diffNote} role="note">{t(textNote)}</p>
        : null}
      {showDiff && hunk !== null
        ? <DiffBlock diffs={[hunk]} className={css.previewDiff} layout="unified" maxLines={12} />
        : null}
    </div>
  )
}

/**
 * Render one turn's changed files. Header + rows open the Status Changes tab
 * when `openOverviewReview` is wired (D-01); otherwise rows open an inline
 * review pane. Hover (500ms) peeks a compact unified diff without opening.
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
      <span className={css.tile}><IconCodeOutline16 size={18} /></span>
      <span className={css.titles}>
        <span className={css.title}>{t('changes.title', { count: String(changes.total) })}</span>
        <span className={css.stat}><Counts t={t} added={changes.added} deleted={changes.deleted} /></span>
      </span>
    </button>
    <ul className={css.list}>
      {rows.map((file, index) => {
        const rowButton = (
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
        )
        const hoverable = file.binary !== true && file.oversized !== true
        return (
          <li key={`${file.display}:${index}`}>
            {hoverable
              ? (
                <HoverCard
                  openDelayMs={HOVER_PREVIEW_DELAY_MS}
                  disabled={reviewing}
                  anchor={rowButton}
                  content={(
                    <ChangedFilePreview
                      seq={changes.seq}
                      index={index}
                      display={file.path}
                      loadFileDiff={loadFileDiff}
                      t={t}
                    />
                  )}
                />
              )
              : rowButton}
          </li>
        )
      })}
    </ul>
    {foldable && <button type="button" className={css.toggle}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'changes.collapseAria' : 'changes.expandAria', { count: String(changes.files.length) })}
      onClick={() => { setExpanded(value => !value) }}>
      <span>{t(expanded ? 'changes.collapse' : 'changes.all', { count: String(changes.files.length) })}</span>
      {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
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
