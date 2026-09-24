/** First-party workbench public face and Host `/sidebar/*` helpers. */

/** One directory listing row from `POST /sidebar/api/fs.tree`. */
export interface WorkbenchFsEntry {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly hidden?: boolean
}

/** Open / close / path focus for the floating workbench panel. */
export interface WorkbenchFace {
  /** Whether the floating panel is currently shown. */
  readonly open: boolean
  /** Focused absolute or workspace-relative file path (preview target). */
  readonly focusPath: string | null
  /** Show the panel; optionally focus a path and refresh the tree. */
  show(path?: string): void
  /** Hide the panel without clearing focus. */
  hide(): void
  /**
   * Open a path in the workbench (show + focus). Returns true when this
   * face handled the open (callers should not fall through to OS openPath).
   */
  openPath(path: string): boolean
}

/** JSON envelope returned by `/sidebar/api/*`. */
interface SidebarApiEnvelope {
  readonly ok?: boolean
  readonly value?: unknown
  readonly error?: { readonly message?: string }
}

/**
 * POST one Host sidebar API method.
 * @param method - API leaf under `/sidebar/api/`.
 * @param payload - JSON body (include sessionId when available).
 */
export async function sidebarApi(
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`/sidebar/api/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`sidebar api ${method}: HTTP ${response.status}`)
  }
  const body = await response.json() as SidebarApiEnvelope
  if (body.ok === false) {
    throw new Error(body.error?.message ?? `sidebar api ${method} failed`)
  }
  return body.value ?? body
}

/**
 * List one directory via Host `fs.tree`.
 * @param sessionId - optional session for cwd resolution.
 * @param dirPath - absolute or workspace-relative directory.
 */
export async function listFsTree(
  sessionId: string | undefined,
  dirPath: string,
): Promise<readonly WorkbenchFsEntry[]> {
  const value = await sidebarApi('fs.tree', {
    ...(sessionId !== undefined ? { sessionId } : {}),
    path: dirPath,
  }) as { entries?: readonly WorkbenchFsEntry[] }
  return value.entries ?? []
}

/**
 * Read text (or detect binary) via Host `fs.read`.
 * @param sessionId - optional session for cwd resolution.
 * @param filePath - absolute or workspace-relative file.
 */
export async function readFsFile(
  sessionId: string | undefined,
  filePath: string,
): Promise<{ kind: 'text'; content: string; truncated: boolean } | { kind: 'binary'; truncated: boolean }> {
  const value = await sidebarApi('fs.read', {
    ...(sessionId !== undefined ? { sessionId } : {}),
    path: filePath,
  }) as { kind?: string; content?: string; truncated?: boolean }
  if (value.kind === 'text' && typeof value.content === 'string') {
    return { kind: 'text', content: value.content, truncated: value.truncated === true }
  }
  return { kind: 'binary', truncated: value.truncated === true }
}

/** Media URL for image/pdf preview through Host file serving. */
export function sidebarFileUrl(sessionId: string | undefined, filePath: string): string {
  const params = new URLSearchParams({ path: filePath })
  if (sessionId !== undefined) params.set('sessionId', sessionId)
  return `/sidebar/file?${params.toString()}`
}

/** True when the basename looks like a common image extension. */
export function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath)
}

/** True when the basename looks like a PDF. */
export function isPdfPath(filePath: string): boolean {
  return /\.pdf$/i.test(filePath)
}
