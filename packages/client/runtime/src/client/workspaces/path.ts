/**
 * Host attachment address (`sha256:…` / `attachment:sha256:…`) — durable id, not a
 * filesystem path. Must never be joined under cwd or handed to a file editor.
 * @param path - candidate open target from chat / tool rows.
 * @returns true when the string is an attachment id spelling.
 */
export function isAttachmentAddress(path: string): boolean {
  const raw = path.trim()
  if (raw === '') return false
  if (raw.toLowerCase().startsWith('attachment:')) {
    return raw.slice('attachment:'.length).trim() !== ''
  }
  return /^sha256:[a-f0-9]+$/i.test(raw)
}

/**
 * Normalize `sha256:…` / `attachment:sha256:…` to the Host attachment id.
 * @param path - candidate open target.
 * @returns `sha256:…` id, or undefined when the string is not an attachment address.
 */
export function normalizeAttachmentId(path: string): string | undefined {
  const raw = path.trim()
  if (!isAttachmentAddress(raw)) return undefined
  if (raw.toLowerCase().startsWith('attachment:')) {
    return raw.slice('attachment:'.length).trim() || undefined
  }
  return raw
}

/**
 * Short display form for an attachment address (tool-row summary / card label).
 * Full digests stay available as the open target (`filePath`).
 * @param path - `sha256:…` or `attachment:sha256:…`.
 * @returns abbreviated `sha256:abc123…def0`, or the input when already short / not an id.
 */
export function formatAttachmentSummary(path: string): string {
  const id = normalizeAttachmentId(path)
  if (id === undefined) return path.trim()
  const hex = id.replace(/^sha256:/i, '')
  if (hex.length <= 14) return `sha256:${hex}`
  return `sha256:${hex.slice(0, 6)}…${hex.slice(-4)}`
}

/**
 * Resolve a workspace-relative path into the Host-facing spelling used by openPath.
 * @param cwd - session workspace root, when known.
 * @param path - absolute or workspace-relative path.
 * @returns an absolute path when a workspace root is available, otherwise the original path.
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  // Attachment ids are content addresses — joining under cwd invents a fake file.
  if (isAttachmentAddress(path)) return path.trim()
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
  if (cwd === undefined || cwd === '') return path
  const separator = isWindowsStylePath(cwd) && cwd.includes('\\') ? '\\' : '/'
  const base = cwd.replace(/[/\\]+$/, '')
  const rel = path.replace(/^[/\\]+/, '')
  // Produced-files "show in folder" opens `.` → workspace root, not `cwd/.`.
  if (rel === '' || rel === '.') return preserveRootSpelling(cwd, base)
  return `${base}${separator}${rel}`
}

/** Whether a path uses a Windows drive or UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/**
 * Keep drive-root / POSIX-root spelling when trailing separators were stripped for join.
 * @param cwd - original workspace root (may include trailing separators).
 * @param base - cwd with trailing separators removed.
 */
function preserveRootSpelling(cwd: string, base: string): string {
  if (/^[A-Za-z]:$/i.test(base)) {
    const sep = cwd.includes('/') && !cwd.includes('\\') ? '/' : '\\'
    return `${base}${sep}`
  }
  if (base === '') return cwd.startsWith('/') ? '/' : cwd
  return base
}
