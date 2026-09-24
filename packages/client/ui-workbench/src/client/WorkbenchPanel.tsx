/**
 * Floating Host `/sidebar/*` workbench: file tree + text/image/pdf preview.
 * Yields geometry to the details column via `--xrk-layout-inset-details`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { FileTypeIcon, IconCloseOutline16, IconFolderClose16 } from '@xrkseek/client-ui-primitives'
import type { WorkbenchController } from './controller.ts'
import {
  isImagePath, isPdfPath, listFsTree, readFsFile, sidebarFileUrl,
  type WorkbenchFsEntry,
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

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

function parentPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return null
  return normalized.slice(0, idx)
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
  const [preview, setPreview] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'text'; content: string; truncated: boolean }
    | { status: 'binary' }
    | { status: 'media'; kind: 'image' | 'pdf'; url: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  const openRef = useRef(open)
  const focusRef = useRef(focusPath)
  openRef.current = open
  focusRef.current = focusPath

  const refreshTree = useCallback(async (path: string) => {
    setTreeError(null)
    try {
      const next = await listFsTree(sessionId, path)
      setEntries(next.filter(entry => entry.hidden !== true))
      setDirPath(path)
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error))
      setEntries([])
    }
  }, [sessionId])

  const loadPreview = useCallback(async (path: string) => {
    setFocusPath(path)
    if (isImagePath(path)) {
      setPreview({ status: 'media', kind: 'image', url: sidebarFileUrl(sessionId, path) })
      return
    }
    if (isPdfPath(path)) {
      setPreview({ status: 'media', kind: 'pdf', url: sidebarFileUrl(sessionId, path) })
      return
    }
    setPreview({ status: 'loading' })
    try {
      const result = await readFsFile(sessionId, path)
      if (result.kind === 'text') {
        setPreview({ status: 'text', content: result.content, truncated: result.truncated })
      } else {
        setPreview({ status: 'binary' })
      }
    } catch (error) {
      setPreview({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [sessionId])

  useEffect(() => {
    return workbench.bindPanel({
      show: (path) => {
        setOpen(true)
        const target = path ?? rootPath
        void refreshTree(parentPath(target) ?? rootPath).then(() => {
          if (path !== undefined) void loadPreview(path)
        })
      },
      hide: () => { setOpen(false) },
      isOpen: () => openRef.current,
      focusPath: () => focusRef.current,
    })
  }, [workbench, rootPath, refreshTree, loadPreview])

  useEffect(() => {
    if (!open) return
    void refreshTree(dirPath || rootPath)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- refresh on first open only

  if (yielded() || !open) return null

  return (
    <aside className={css.root} data-workbench-panel aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <button type="button" className={css.iconBtn} aria-label={t('close')} onClick={() => setOpen(false)}>
          <IconCloseOutline16 size={16} />
        </button>
      </header>
      <div className={css.body}>
        <nav className={css.tree} aria-label={t('tree')}>
          <div className={css.treeToolbar}>
            <button
              type="button"
              className={css.treeBtn}
              onClick={() => {
                const parent = parentPath(dirPath)
                if (parent) void refreshTree(parent)
              }}
            >
              {t('up')}
            </button>
            <button type="button" className={css.treeBtn} onClick={() => void refreshTree(dirPath)}>
              {t('refresh')}
            </button>
          </div>
          {treeError !== null && <p className={css.error}>{treeError}</p>}
          {entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              className={css.entry}
              data-active={focusPath === entry.path || undefined}
              onClick={() => {
                if (entry.isDir) void refreshTree(entry.path)
                else void loadPreview(entry.path)
              }}
            >
              <span aria-hidden>
                {entry.isDir
                  ? <IconFolderClose16 size={14} />
                  : <FileTypeIcon path={entry.name} size={14} />}
              </span>
              <span className={css.entryName}>{entry.name}</span>
            </button>
          ))}
        </nav>
        <section className={css.preview}>
          {focusPath !== null && <p className={css.previewPath} title={focusPath}>{basename(focusPath)}</p>}
          <div className={css.previewBody}>
            {preview.status === 'idle' && <p className={css.hint}>{t('empty')}</p>}
            {preview.status === 'loading' && <p className={css.hint}>{t('loading')}</p>}
            {preview.status === 'error' && <p className={css.error}>{t('error')}: {preview.message}</p>}
            {preview.status === 'binary' && focusPath !== null && (
              <div>
                <p className={css.hint}>{t('binary')}</p>
                <button type="button" className={css.treeBtn} onClick={() => openInOs(focusPath)}>
                  {t('openOs')}
                </button>
              </div>
            )}
            {preview.status === 'text' && (
              <>
                {preview.truncated && <p className={css.hint}>{t('truncated')}</p>}
                <pre className={css.code}>{preview.content}</pre>
              </>
            )}
            {preview.status === 'media' && preview.kind === 'image' && (
              <img className={css.image} src={preview.url} alt={focusPath ?? ''} />
            )}
            {preview.status === 'media' && preview.kind === 'pdf' && (
              <iframe className={css.frame} title={focusPath ?? 'pdf'} src={preview.url} />
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
