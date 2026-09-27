/** First-party workbench public face and Host `/sidebar/*` helpers. */

/** One directory listing row from `POST /sidebar/api/fs.tree`. */
export interface WorkbenchFsEntry {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly hidden?: boolean
  /** File size in bytes (files only; omitted when the Host skipped stat). */
  readonly size?: number
  /** Last-modified epoch ms (files only). */
  readonly mtimeMs?: number
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
 * Recursive file-name search under a root via Host `fs.search`.
 * @param sessionId - optional session for cwd resolution.
 * @param rootPath - absolute or workspace-relative root directory.
 * @param query - case-insensitive name substring.
 * @returns relative matches (forward slashes) plus truncation flag.
 */
export async function searchFsFiles(
  sessionId: string | undefined,
  rootPath: string,
  query: string,
): Promise<{ matches: readonly string[]; truncated: boolean }> {
  const value = await sidebarApi('fs.search', {
    ...(sessionId !== undefined ? { sessionId } : {}),
    path: rootPath,
    query,
  }) as { matches?: readonly string[]; truncated?: boolean }
  return { matches: value.matches ?? [], truncated: value.truncated === true }
}

/**
 * Stat one path via Host `fs.stat` (size / mtime for the preview header).
 * @param sessionId - optional session for cwd resolution.
 * @param filePath - absolute or workspace-relative path.
 * @returns stat fields, or null when the Host reports the path missing.
 */
export async function statFsPath(
  sessionId: string | undefined,
  filePath: string,
): Promise<{ size: number; mtimeMs: number; isDir: boolean } | null> {
  try {
    const value = await sidebarApi('fs.stat', {
      ...(sessionId !== undefined ? { sessionId } : {}),
      path: filePath,
    }) as { size?: number; mtimeMs?: number; isDir?: boolean }
    if (typeof value.size !== 'number' || typeof value.mtimeMs !== 'number') return null
    return { size: value.size, mtimeMs: value.mtimeMs, isDir: value.isDir === true }
  } catch {
    // Missing files are a normal preview state — never surface as an error banner.
    return null
  }
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

/** Media URL for image / pdf / audio / video preview through Host file serving. */
export function sidebarFileUrl(sessionId: string | undefined, filePath: string): string {
  const params = new URLSearchParams({ path: filePath })
  if (sessionId !== undefined) params.set('sessionId', sessionId)
  return `/sidebar/file?${params.toString()}`
}

/** True when the basename looks like a common image extension. */
export function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(filePath)
}

/** True when the basename looks like a PDF. */
export function isPdfPath(filePath: string): boolean {
  return /\.pdf$/i.test(filePath)
}

/** True when the basename looks like Markdown (render instead of `<pre>`). */
export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(filePath)
}

/** True when the basename looks like JSON (offer a collapsible tree). */
export function isJsonPath(filePath: string): boolean {
  return /\.(json|jsonc|json5|webmanifest|har)$/i.test(filePath)
}

/** True when the basename looks like a playable audio file. */
export function isAudioPath(filePath: string): boolean {
  return /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(filePath)
}

/** True when the basename looks like a playable video file. */
export function isVideoPath(filePath: string): boolean {
  return /\.(mp4|webm|ogv|mov|m4v|mkv)$/i.test(filePath)
}

/** Extension → shiki lang id for the code preview. */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx', jsx: 'jsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'jsonc', json5: 'json5',
  md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  py: 'python', pyi: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', dart: 'dart',
  scala: 'scala', zig: 'zig', jl: 'julia', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hs: 'haskell', clj: 'clojure', lua: 'lua', pl: 'perl', r: 'r',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', ksh: 'shellscript',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', bat: 'bat', cmd: 'bat',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini',
  env: 'dotenv', properties: 'properties',
  xml: 'xml', svg: 'xml', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'proto',
  diff: 'diff', patch: 'diff', log: 'log',
  tf: 'hcl', hcl: 'hcl', nix: 'nix', vim: 'vim', cmake: 'cmake',
  txt: 'text', text: 'text',
}

/**
 * Guess a shiki language id from a file name.
 * @param filePath - full path or bare file name.
 * @returns lang id, or undefined for unknown / extension-less names.
 */
export function langForPath(filePath: string): string | undefined {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return undefined
  return LANG_BY_EXTENSION[lower.slice(dot + 1)]
}

/** Last path segment (handles Windows separators and trailing slashes). */
export function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || filePath
}

/**
 * Parent directory of a path.
 * @param filePath - any file or directory path.
 * @returns parent path, or null at a drive / filesystem root boundary.
 */
export function parentPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return null
  return normalized.slice(0, idx)
}

/**
 * Join a tree-root-relative path onto an absolute / workspace root.
 * @param rootPath - tree root.
 * @param relative - relative path (forward or back slashes).
 * @returns joined path with forward slashes.
 */
export function joinFsPath(rootPath: string, relative: string): string {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!root) return `/${rel}`
  return `${root}/${rel}`
}

/** One clickable breadcrumb segment. */
export interface WorkbenchCrumb {
  readonly name: string
  readonly path: string
}

/**
 * Build the breadcrumb trail from the tree root down to the current directory.
 * Paths outside the root (e.g. an absolute chat open) collapse to a single crumb.
 * @param rootPath - tree root.
 * @param dirPath - current directory.
 * @returns crumbs, always containing at least one entry.
 */
export function breadcrumbs(rootPath: string, dirPath: string): readonly WorkbenchCrumb[] {
  const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = norm(rootPath)
  const dir = norm(dirPath)
  if (!root) return [{ name: dir, path: dir }]
  const head: WorkbenchCrumb = { name: basename(root) || root, path: root }
  if (dir === root) return [head]
  if (!dir.startsWith(`${root}/`)) return [{ name: basename(dir) || dir, path: dir }]
  const crumbs: WorkbenchCrumb[] = [head]
  let acc = root
  for (const part of dir.slice(root.length + 1).split('/')) {
    if (!part) continue
    acc = `${acc}/${part}`
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
}
