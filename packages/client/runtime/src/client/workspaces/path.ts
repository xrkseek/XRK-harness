/**
 * Resolve a workspace-relative path into the Host-facing spelling used by openPath.
 * @param cwd - session workspace root, when known.
 * @param path - absolute or workspace-relative path.
 * @returns an absolute path when a workspace root is available, otherwise the original path.
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
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
