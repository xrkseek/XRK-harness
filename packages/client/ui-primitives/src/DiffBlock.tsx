// DiffBlock: the inline-diff surface for a file mutation (write/edit) — a copy
// control over one or more per-file hunks. Unified mode stacks removed then
// added lines (legacy). Split mode (DSH ReviewTab / Codex side-by-side subset)
// pairs deletions with additions in two columns with synchronized scroll.
// Syntax highlighting reuses CodeBlock/ReadBlock shiki (`highlightLines`) per
// side, keyed off the hunk path's file extension.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import { fileExtension } from './FileTypeIcon.tsx'
import {
  grammarLoadCount,
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import css from './DiffBlock.module.css'

/**
 * Output lines shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a diff card and a terminal card cut a
 * long body at the same place.
 */
export const DEFAULT_DIFF_MAX_LINES = 16

/**
 * One file's change, in the shape {@link DiffBlock} draws. Structurally the
 * render-intent contract's `FileDiff`, redeclared here so this primitive stays
 * free of the tool contract (the terminal card's decoupling, applied to diffs).
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
}

/** Unified (stacked) vs side-by-side columns. */
export type DiffLayout = 'unified' | 'split'

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: DiffHunk[]
  /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /**
   * Initial layout. User can toggle; omit for unified (back-compat).
   * Split pairs old/new columns with synced vertical scroll.
   */
  layout?: DiffLayout | undefined
  /**
   * Soft-wrap long lines (DSH ReviewTab wrap). Default false keeps `white-space: pre`
   * so indentation stays readable; the toolbar can toggle at runtime.
   */
  wrap?: boolean | undefined
}

/** A single rendered body line and its role, so the height cap slices a flat list. */
interface DiffRow {
  kind: 'path' | 'del' | 'add' | 'gap'
  text: string
  /** 1-based old-side line number (del rows). */
  oldNo?: number
  /** 1-based new-side line number (add rows). */
  newNo?: number
  /** Optional shiki runs for the line body (absent = plain monospace). */
  spans?: readonly HighlightSpan[]
}

/** One paired side-by-side row (DSH ReviewTab `splitRows` subset). */
interface SplitPair {
  left?: { text: string; kind: 'del'; oldNo: number; spans?: readonly HighlightSpan[] }
  right?: { text: string; kind: 'add'; newNo: number; spans?: readonly HighlightSpan[] }
}

/** Map a hunk path to a highlighter language id (file extension). */
function langFromDiffPath(path: string): string | undefined {
  const ext = fileExtension(path).toLowerCase()
  return ext.length > 0 ? ext : undefined
}

function renderSpans(spans: readonly HighlightSpan[]): ReactNode {
  return spans.map((span, index) => (
    <span key={index} style={span.style as CSSProperties}>{span.text}</span>
  ))
}

function renderLineBody(text: string, spans: readonly HighlightSpan[] | undefined): ReactNode {
  if (spans === undefined || spans.length === 0) return text
  return renderSpans(spans)
}

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/** The dim class per row kind (path/gap chrome vs the diff's own +/- colors). */
const ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  path: css.path,
  del: css.del,
  add: css.add,
  gap: css.gap,
}

/**
 * Flatten the hunks into the body's rows plus the footer counts. A path header
 * opens each new file; a same-file second hunk (a scattered edit) opens with a
 * `⋯` gap instead of repeating the path. Every old-side line counts toward
 * `removed` and every new-side line toward `added`. The file count is of
 * DISTINCT paths, matching the TUI diff card's footer, so two hunks in one file
 * read as `1 file` on both front ends.
 * @param diffs - the hunks to render.
 * @returns the body rows, the +/- totals, and the distinct-file count.
 */
function buildRows(diffs: DiffHunk[]): { rows: DiffRow[]; added: number; removed: number; files: number } {
  const rows: DiffRow[] = []
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  let prevPath: string | undefined
  let oldNo = 0
  let newNo = 0
  for (const diff of diffs) {
    paths.add(diff.path)
    if (diff.path !== prevPath) {
      rows.push({ kind: 'path', text: diff.path })
      oldNo = 0
      newNo = 0
    } else {
      rows.push({ kind: 'gap', text: '⋯' })
    }
    prevPath = diff.path
    const lang = langFromDiffPath(diff.path)
    const oldHl = diff.oldText !== null ? highlightLines(diff.oldText, lang) : undefined
    const newHl = highlightLines(diff.newText, lang)
    let oldIdx = 0
    let newIdx = 0
    if (diff.oldText !== null) {
      for (const line of contentLines(diff.oldText)) {
        oldNo += 1
        const spans = oldHl?.[oldIdx++]
        rows.push({
          kind: 'del',
          text: line,
          oldNo,
          ...(spans !== undefined ? { spans } : {}),
        })
        removed++
      }
    }
    for (const line of contentLines(diff.newText)) {
      newNo += 1
      const spans = newHl?.[newIdx++]
      rows.push({
        kind: 'add',
        text: line,
        newNo,
        ...(spans !== undefined ? { spans } : {}),
      })
      added++
    }
  }
  return { rows, added, removed, files: paths.size }
}

/**
 * Pair old/new lines for side-by-side: deletions align with following additions
 * row-by-row (DSH ReviewTab `splitRows` flush semantics on whole-file sides).
 */
function buildSplit(diffs: DiffHunk[]): {
  sections: { path: string; pairs: SplitPair[] }[]
  added: number
  removed: number
  files: number
} {
  const sections: { path: string; pairs: SplitPair[] }[] = []
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    paths.add(diff.path)
    const dels = diff.oldText !== null ? contentLines(diff.oldText) : []
    const adds = contentLines(diff.newText)
    const lang = langFromDiffPath(diff.path)
    const oldHl = diff.oldText !== null ? highlightLines(diff.oldText, lang) : undefined
    const newHl = highlightLines(diff.newText, lang)
    removed += dels.length
    added += adds.length
    const pairs: SplitPair[] = []
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      const left = dels[i]
      const right = adds[i]
      const leftSpans = oldHl?.[i]
      const rightSpans = newHl?.[i]
      pairs.push({
        ...(left !== undefined
          ? {
            left: {
              text: left,
              kind: 'del' as const,
              oldNo: i + 1,
              ...(leftSpans !== undefined ? { spans: leftSpans } : {}),
            },
          }
          : {}),
        ...(right !== undefined
          ? {
            right: {
              text: right,
              kind: 'add' as const,
              newNo: i + 1,
              ...(rightSpans !== undefined ? { spans: rightSpans } : {}),
            },
          }
          : {}),
      })
    }
    sections.push({ path: diff.path, pairs })
  }
  return { sections, added, removed, files: paths.size }
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const endsWithNewline = text.endsWith('\n')
  const body = endsWithNewline ? text.slice(0, -1) : text
  return body.length === 0 ? [''] : body.split('\n')
}

function renderUnifiedLine(row: DiffRow): ReactNode {
  if (row.kind !== 'del' && row.kind !== 'add') return row.text
  const sign = row.kind === 'add' ? '+' : '-'
  const lineNo = row.kind === 'add' ? (row.newNo ?? '') : (row.oldNo ?? '')
  return (
    <>
      <span className={css.gutter} aria-hidden="true" data-diff-gutter="" data-sides="one">
        <span className={css.gutterNo}>{lineNo}</span>
        <span className={css.sign}>{sign}</span>
      </span>
      <span className={css.lineText} data-diff-highlight={row.spans !== undefined ? 'true' : undefined}>
        {renderLineBody(row.text, row.spans)}
      </span>
    </>
  )
}

function renderSplitSide(
  side: {
    text: string
    kind: 'del' | 'add'
    oldNo?: number
    newNo?: number
    spans?: readonly HighlightSpan[]
  } | undefined,
  emptyClass: string,
): ReactNode {
  if (side === undefined) {
    return <div className={clsx(css.line, emptyClass)}>{'\u00a0'}</div>
  }
  const lineNo = side.oldNo ?? side.newNo ?? ''
  const sign = side.kind === 'add' ? '+' : '-'
  return (
    <div className={clsx(css.line, side.kind === 'del' ? css.del : css.add)}>
      <span className={css.gutter} aria-hidden="true" data-diff-gutter="" data-sides="one">
        <span className={css.gutterNo}>{lineNo}</span>
        <span className={css.sign}>{sign}</span>
      </span>
      <span className={css.lineText} data-diff-highlight={side.spans !== undefined ? 'true' : undefined}>
        {renderLineBody(side.text, side.spans)}
      </span>
    </div>
  )
}

/**
 * The diff text a reader copies: each row's `-`/`+`/path/gap prefix and its
 * content, exactly what the card shows. The removed and added blocks are the
 * change; the path headers keep a multi-file copy attributable.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows: DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'path': return row.text
      case 'gap': return row.text
      /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
      default: return assertNever(row.kind)
    }
  }).join('\n')
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({
  diffs,
  maxLines = DEFAULT_DIFF_MAX_LINES,
  className,
  layout: layoutProp = 'unified',
  wrap: wrapProp = false,
}: DiffBlockProps) {
  // Re-build when a lazy grammar finishes loading (same seat as ReadBlock).
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const { rows, added, removed, files } = useMemo(() => buildRows(diffs), [diffs, loaded])
  const split = useMemo(() => buildSplit(diffs), [diffs, loaded])
  const [layout, setLayout] = useState<DiffLayout>(layoutProp)
  const [wrap, setWrap] = useState(wrapProp)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  const syncing = useRef(false)

  useEffect(() => { setWrap(wrapProp) }, [wrapProp])

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])
  const onToggleLayout = useCallback(() => {
    setLayout(value => (value === 'unified' ? 'split' : 'unified'))
  }, [])
  const onToggleWrap = useCallback(() => {
    setWrap((value) => !value)
  }, [])

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return
    const from = source === 'left' ? leftRef.current : rightRef.current
    const to = source === 'left' ? rightRef.current : leftRef.current
    if (!from || !to) return
    syncing.current = true
    to.scrollTop = from.scrollTop
    to.scrollLeft = from.scrollLeft
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  if (rows.length === 0) return null

  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
  // card, so a body's head and tail slices agree across the front ends.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? rows.slice(0, headLines) : rows
  const tail = capped ? rows.slice(rows.length - tailLines) : []

  return (
    <div
      className={clsx(css.block, className)}
      data-diff=""
      data-diff-layout={layout}
      data-diff-wrap={wrap ? 'true' : undefined}
    >
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.layoutButton}
          aria-pressed={layout === 'split'}
          aria-label={layout === 'split' ? '切换为统一视图' : '切换为分栏视图'}
          title={layout === 'split' ? '统一视图' : '分栏视图'}
          onClick={onToggleLayout}
        >
          {layout === 'split' ? '统一' : '分栏'}
        </button>
        <button
          type="button"
          className={css.layoutButton}
          aria-pressed={wrap}
          aria-label={wrap ? '关闭自动换行' : '开启自动换行'}
          title={wrap ? '不换行' : '换行'}
          data-diff-tool="wrap"
          onClick={onToggleWrap}
        >
          {wrap ? '不换行' : '换行'}
        </button>
        <button type="button" className={css.copyButton} onClick={onCopy}>
          {copied ? '复制成功' : '复制'}
        </button>
      </div>
      {layout === 'split' ? (
        <div className={css.splitBody}>
          {split.sections.map((section, sIndex) => (
            <div key={sIndex} className={css.splitSection}>
              <div className={clsx(css.line, css.path)}>{section.path}</div>
              <div className={css.splitColumns}>
                <div
                  ref={sIndex === 0 ? leftRef : undefined}
                  className={css.splitPane}
                  data-side="old"
                  onScroll={sIndex === 0 ? () => { syncScroll('left') } : undefined}
                >
                  {section.pairs.map((pair, i) => (
                    <Fragment key={i}>
                      {renderSplitSide(pair.left, css.splitEmpty ?? '')}
                    </Fragment>
                  ))}
                </div>
                <div
                  ref={sIndex === 0 ? rightRef : undefined}
                  className={css.splitPane}
                  data-side="new"
                  onScroll={sIndex === 0 ? () => { syncScroll('right') } : undefined}
                >
                  {section.pairs.map((pair, i) => (
                    <Fragment key={i}>
                      {renderSplitSide(pair.right, css.splitEmpty ?? '')}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={css.body}>
          {head.map((row, index) => (
            <div key={index} className={clsx(css.line, ROW_CLASS[row.kind])}>
              {renderUnifiedLine(row)}
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className={css.expand}
              aria-expanded={expanded}
              aria-label={expanded ? '收起差异' : `展开其余 ${hidden} 行差异`}
              onClick={onToggle}
            >
              {expanded ? '收起' : `… 其余 ${hidden} 行`}
            </button>
          )}
          {tail.map((row, index) => (
            <div key={index} className={clsx(css.line, ROW_CLASS[row.kind])}>
              {renderUnifiedLine(row)}
            </div>
          ))}
        </div>
      )}
      <div className={css.footer}>└ +{added} -{removed} · {files} file{files === 1 ? '' : 's'}</div>
    </div>
  )
}
