/**
 * Floating Host `/sidebar/*` workbench: breadcrumb file tree + typed preview
 * (markdown · shiki code · JSON tree · image · pdf · audio · video).
 * Yields geometry to the details column via `--xrk-layout-inset-details`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  CodeBlock, FileTypeIcon, IconChevronLeftOutline14, IconCloseOutline16, IconCopyOutline16,
  IconFolderClose16, IconRefreshOutline14, IconRightUpOutline16, IconSearchOutline16,
  JsonTree, MarkdownText, fileSizeText, writeClipboard,
} from '@xrkseek/client-ui-primitives'
import type { WorkbenchController } from './controller.ts'
import {
  basename, breadcrumbs, isAudioPath, isImagePath, isJsonPath, isMarkdownPath, isPdfPath,
  isVideoPath, joinFsPath, langForPath, listFsTree, parentPath, readFsFile, searchFsFiles,
  sidebarFileUrl, statFsPath, type WorkbenchFsEntry,
} from './fs-api.ts'
import css from './WorkbenchPanel.module.css'

/** Injected controller + optional session cwd / OS open. */
export interface WorkbenchPanelInjected {
  workbench: WorkbenchController
  /** Current session id for Host sidebar cwd resolution (optional). */
  sessionId?: string
  /** Absolute or workspace path used as the tree root. */
  rootPath: string
  /** Fall through to Host OS open for binaries / explicit action. */
  openInOs: (path: string) => void
  /** Live yield check — community sidebar claimed the surface. */
  yielded: () => boolean
}

export type WorkbenchPanelProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<WorkbenchPanelInjected>
  & PropsLocale<'workbench'>

/** One rendered list row (directory entry or search hit). */
interface WorkbenchRow {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly size?: number | undefined
  readonly mtimeMs?: number | undefined
}

/** Media kinds streamed through `/sidebar/file`. */
type MediaKind = 'image' | 'pdf' | 'audio' | 'video'

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'text'; content: string; truncated: boolean; lang: string | undefined }
  | { status: 'media'; kind: MediaKind; url: string }
  | { status: 'binary' }
  | { status: 'error'; message: string }

/** Media kind for a path, or null when it is not streamable media. */
function mediaKindOf(filePath: string): MediaKind | null {
  if (isImagePath(filePath)) return 'image'
  if (isPdfPath(filePath)) return 'pdf'
  if (isAudioPath(filePath)) return 'audio'
  if (isVideoPath(filePath)) return 'video'
  return null
}

/**
 * Render the floating workbench when open.
 * @param props - slot runtime + inject + locale.
 */
export function WorkbenchPanel({
  workbench, sessionId, rootPath, openInOs, yielded, t,
}: WorkbenchPanelProps) {
  const [open, setOpen] = useState(false)
  const [dirPath, setDirPath] = useState(rootPath)
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<readonly WorkbenchFsEntry[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchHits, setSearchHits] = useState<readonly string[] | null>(null)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [meta, setMeta] = useState<{ size: number | undefined; mtimeMs: number | undefined }>({
    size: undefined, mtimeMs: undefined,
  })
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const openRef = useRef(open)
  const focusRef = useRef(focusPath)
  const listRef = useRef<HTMLDivElement>(null)
  openRef.current = open
  focusRef.current = focusPath

  const refreshTree = useCallback(async (path: string) => {
    setTreeError(null)
    try {
      const next = await listFsTree(sessionId, path)
      setEntries(next)
      setDirPath(path)
      setActiveIndex(-1)
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error))
      setEntries([])
    }
  }, [sessionId])

  const loadPreview = useCallback(async (path: string) => {
    setFocusPath(path)
    setCopyState('idle')
    const media = mediaKindOf(path)
    if (media !== null) {
      setPreview({ status: 'media', kind: media, url: sidebarFileUrl(sessionId, path) })
    } else {
      setPreview({ status: 'loading' })
      try {
        const result = await readFsFile(sessionId, path)
        if (result.kind === 'text') {
          setPreview({
            status: 'text',
            content: result.content,
            truncated: result.truncated,
            lang: langForPath(path),
          })
        } else {
          setPreview({ status: 'binary' })
        }
      } catch (error) {
        setPreview({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const stat = await statFsPath(sessionId, path)
    setMeta({ size: stat?.size, mtimeMs: stat?.mtimeMs })
  }, [sessionId])

  useEffect(() => {
    return workbench.bindPanel({
      show: (path) => {
        setOpen(true)
        if (path === undefined) {
          void refreshTree(rootPath)
          return
        }
        void (async () => {
          // A chat / tree open may target a directory — browse it instead of
          // trying (and failing) to read a directory as a file.
          const stat = await statFsPath(sessionId, path)
          if (stat?.isDir === true) {
            await refreshTree(path)
            return
          }
          await refreshTree(parentPath(path) ?? rootPath)
          await loadPreview(path)
        })()
      },
      hide: () => { setOpen(false) },
      isOpen: () => openRef.current,
      focusPath: () => focusRef.current,
    })
  }, [workbench, rootPath, sessionId, refreshTree, loadPreview])

  useEffect(() => {
    if (!open) return
    void refreshTree(dirPath || rootPath)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- refresh on first open only

  // Session / workspace switch: reset the browse root (never mid-browse).
  useEffect(() => {
    if (openRef.current) return
    setDirPath(rootPath)
    setSearchDraft('')
    setSearchHits(null)
  }, [rootPath])

  // Debounced recursive file-name search under the tree root.
  useEffect(() => {
    const query = searchDraft.trim()
    if (!query) {
      setSearchHits(null)
      setSearchTruncated(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchFsFiles(sessionId, rootPath, query).then((result) => {
        if (cancelled) return
        setSearchHits(result.matches)
        setSearchTruncated(result.truncated)
        setActiveIndex(-1)
      }).catch(() => {
        if (cancelled) return
        setSearchHits([])
        setSearchTruncated(false)
      })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchDraft, sessionId, rootPath])

  const searching = searchDraft.trim().length > 0
  const rows = useMemo<readonly WorkbenchRow[]>(() => {
    if (searching && searchHits !== null) {
      return searchHits.map(relative => ({
        name: relative,
        path: joinFsPath(rootPath, relative),
        isDir: false,
        size: undefined,
        mtimeMs: undefined,
      }))
    }
    if (searching) return []
    return entries
      .filter(entry => showHidden || entry.hidden !== true)
      .map(entry => ({
        name: entry.name,
        path: entry.path,
        isDir: entry.isDir,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
      }))
  }, [searching, searchHits, entries, showHidden, rootPath])

  const jsonData = useMemo<object | unknown[] | undefined>(() => {
    if (preview.status !== 'text' || focusPath === null || !isJsonPath(focusPath)) return undefined
    try {
      const parsed = JSON.parse(preview.content) as unknown
      return typeof parsed === 'object' && parsed !== null ? parsed as object | unknown[] : undefined
    } catch {
      // jsonc / json5 / partial file: fall back to the highlighted source.
      return undefined
    }
  }, [preview, focusPath])

  const openRow = useCallback((row: WorkbenchRow) => {
    if (row.isDir) void refreshTree(row.path)
    else void loadPreview(row.path)
  }, [refreshTree, loadPreview])

  useEffect(() => {
    if (activeIndex < 0) return
    const node = listRef.current?.querySelector(`[data-index="${activeIndex}"]`)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rows])

  const onListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      setActiveIndex((current) => {
        const base = current < 0 ? (event.key === 'ArrowDown' ? -1 : rows.length) : current
        return event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, base + 1)
          : Math.max(0, base - 1)
      })
      return
    }
    if (event.key === 'Enter') {
      const row = rows[activeIndex]
      if (row !== undefined) {
        event.preventDefault()
        openRow(row)
      }
      return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      const parent = parentPath(dirPath)
      if (parent !== null) void refreshTree(parent)
    }
  }, [rows, activeIndex, openRow, dirPath, refreshTree])

  const copyPath = useCallback(() => {
    if (focusPath === null) return
    void writeClipboard(focusPath).then((ok) => {
      setCopyState(ok ? 'ok' : 'fail')
      window.setTimeout(() => setCopyState('idle'), 1600)
    })
  }, [focusPath])

  if (yielded() || !open) return null

  const crumbs = breadcrumbs(rootPath, dirPath)
  const absolutePath = focusPath ?? null

  return (
    <aside className={css.root} data-workbench-panel aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <button
          type="button"
          className={css.iconBtn}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => void refreshTree(dirPath)}
        >
          <IconRefreshOutline14 size={14} />
        </button>
        <button type="button" className={css.iconBtn} aria-label={t('close')} onClick={() => setOpen(false)}>
          <IconCloseOutline16 size={16} />
        </button>
      </header>
      <div className={css.body}>
        <nav className={css.tree} aria-label={t('tree')}>
          <div className={css.searchRow}>
            <IconSearchOutline16 size={14} />
            <input
              className={css.searchInput}
              type="search"
              value={searchDraft}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            {searching && (
              <button
                type="button"
                className={css.iconBtn}
                aria-label={t('clear')}
                title={t('clear')}
                onClick={() => setSearchDraft('')}
              >
                <IconCloseOutline16 size={14} />
              </button>
            )}
          </div>
          <div className={css.crumbs}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className={css.crumbItem}>
                {index > 0 && <span className={css.crumbSep} aria-hidden>/</span>}
                <button
                  type="button"
                  className={css.crumb}
                  data-current={index === crumbs.length - 1 || undefined}
                  title={crumb.path}
                  onClick={() => {
                    setSearchDraft('')
                    void refreshTree(crumb.path)
                  }}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <div className={css.treeToolbar}>
            <button
              type="button"
              className={css.treeBtn}
              title={t('up')}
              onClick={() => {
                const parent = parentPath(dirPath)
                if (parent) void refreshTree(parent)
              }}
            >
              <IconChevronLeftOutline14 size={12} />
              {t('up')}
            </button>
            <button
              type="button"
              className={css.treeBtn}
              data-on={showHidden || undefined}
              title={showHidden ? t('hideHidden') : t('showHidden')}
              onClick={() => setShowHidden(value => !value)}
            >
              {showHidden ? t('hideHidden') : t('showHidden')}
            </button>
          </div>
          {treeError !== null && <p className={css.error}>{treeError}</p>}
          <div
            className={css.list}
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label={t('tree')}
            onKeyDown={onListKeyDown}
          >
            {searching && searchHits !== null && searchHits.length === 0 && (
              <p className={css.hint}>{t('searchEmpty')}</p>
            )}
            {!searching && rows.length === 0 && treeError === null && (
              <p className={css.hint}>{t('emptyDir')}</p>
            )}
            {searchTruncated && <p className={css.hint}>{t('searchTruncated')}</p>}
            {rows.map((row, index) => (
              <button
                key={`${row.path}#${index}`}
                type="button"
                data-index={index}
                className={css.entry}
                data-active={focusPath === row.path || activeIndex === index || undefined}
                title={row.path}
                onMouseDown={() => setActiveIndex(index)}
                onClick={() => openRow(row)}
              >
                <span aria-hidden>
                  {row.isDir
                    ? <IconFolderClose16 size={14} />
                    : <FileTypeIcon path={row.name} size={14} />}
                </span>
                <span className={css.entryName}>{row.name}</span>
                {row.isDir !== true && row.size !== undefined && (
                  <span className={css.entrySize}>{fileSizeText(row.size)}</span>
                )}
              </button>
            ))}
          </div>
          <p className={css.hint}>{t('hint')}</p>
        </nav>
        <section className={css.preview}>
          {absolutePath !== null && (
            <div className={css.previewHeader}>
              <div className={css.previewMeta}>
                <p className={css.previewPath} title={absolutePath}>{basename(absolutePath)}</p>
                {(meta.size !== undefined || meta.mtimeMs !== undefined) && (
                  <p className={css.previewFacts}>
                    {meta.size !== undefined && `${t('size')} ${fileSizeText(meta.size)}`}
                    {meta.size !== undefined && meta.mtimeMs !== undefined && ' · '}
                    {meta.mtimeMs !== undefined && `${t('modified')} ${new Date(meta.mtimeMs).toLocaleString()}`}
                  </p>
                )}
              </div>
              <div className={css.previewActions}>
                <button
                  type="button"
                  className={css.iconBtn}
                  title={copyState === 'ok' ? t('copied') : copyState === 'fail' ? t('copyFailed') : t('copyPath')}
                  aria-label={copyState === 'ok' ? t('copied') : t('copyPath')}
                  onClick={copyPath}
                >
                  <IconCopyOutline16 size={14} />
                </button>
                <button
                  type="button"
                  className={css.iconBtn}
                  title={t('openOs')}
                  aria-label={t('openOs')}
                  onClick={() => openInOs(absolutePath)}
                >
                  <IconRightUpOutline16 size={14} />
                </button>
              </div>
            </div>
          )}
          <div className={css.previewBody}>
            {preview.status === 'idle' && <p className={css.hint}>{t('empty')}</p>}
            {preview.status === 'loading' && <p className={css.hint}>{t('loading')}</p>}
            {preview.status === 'error' && <p className={css.error}>{t('error')}: {preview.message}</p>}
            {preview.status === 'binary' && absolutePath !== null && (
              <div>
                <p className={css.hint}>{t('binary')}</p>
                <button type="button" className={css.treeBtn} onClick={() => openInOs(absolutePath)}>
                  {t('openOs')}
                </button>
              </div>
            )}
            {preview.status === 'text' && absolutePath !== null && (
              <>
                {preview.truncated && <p className={css.hint}>{t('truncated')}</p>}
                {isMarkdownPath(absolutePath)
                  ? (
                    <div className={css.markdown}>
                      <MarkdownText text={preview.content} />
                    </div>
                  )
                  : jsonData !== undefined
                    ? <JsonTree data={jsonData} label={t('jsonTree')} />
                    : (
                      <CodeBlock
                        code={preview.content}
                        lang={preview.lang}
                        copyLabel={t('copy')}
                        copiedLabel={t('copied')}
                      />
                    )}
              </>
            )}
            {preview.status === 'media' && preview.kind === 'image' && (
              <img className={css.image} src={preview.url} alt={absolutePath ?? ''} />
            )}
            {preview.status === 'media' && preview.kind === 'pdf' && (
              <iframe className={css.frame} title={absolutePath ?? t('title')} src={preview.url} />
            )}
            {preview.status === 'media' && preview.kind === 'audio' && (
              <audio className={css.audio} controls src={preview.url} />
            )}
            {preview.status === 'media' && preview.kind === 'video' && (
              <video className={css.video} controls src={preview.url} />
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
