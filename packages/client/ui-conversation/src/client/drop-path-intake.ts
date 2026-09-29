/**
 * Folder / absolute-path drop intake: directories are path references (`@…/`),
 * not FileReader byte uploads (Chromium fails with ENOENT-style messages).
 */

import type { ReferenceInsert } from '@xrkseek/client-ui-input-trigger/client'

/** One OS path resolved from a dropped File (Desktop `webUtils.getPathForFile`). */
export interface DroppedPathRef {
  readonly path: string
  readonly kind: 'file' | 'directory'
}

type DesktopFilesBridge = {
  readonly pathForFile?: (file: File) => string | undefined | null
}

/** Read Electron preload `xrkDesktop.files.pathForFile` when present. */
export function desktopPathForFile(file: File): string | undefined {
  const bridge = (globalThis as { xrkDesktop?: { files?: DesktopFilesBridge } })
    .xrkDesktop?.files
  if (bridge?.pathForFile === undefined) return undefined
  try {
    const raw = bridge.pathForFile(file)
    if (typeof raw !== 'string') return undefined
    const trimmed = raw.trim()
    return trimmed === '' ? undefined : trimmed
  } catch {
    return undefined
  }
}

/** Normalize OS path separators for `@` mention grammar. */
export function normalizeMentionPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Build a reference chip insert for one absolute (or workspace) path.
 * Mirrors `formatFileMention` quoting rules without taking a new package dep.
 */
export function pathReferenceInsert(
  path: string,
  kind: 'file' | 'directory',
): ReferenceInsert | undefined {
  const normalized = normalizeMentionPath(path.trim())
  if (normalized === '') return undefined
  const mentionPath =
    kind === 'directory'
      ? (normalized.endsWith('/') ? normalized : `${normalized}/`)
      : normalized.replace(/\/+$/u, '') || normalized
  // Control chars / embedded quotes break the `@` / `@"…"` grammar.
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(mentionPath)) return undefined
  const quoted = /\s/u.test(mentionPath)
  const mention = !quoted
    ? `@${mentionPath}`
    : kind === 'directory'
      ? `@"${mentionPath}`
      : `@"${mentionPath}"`
  const leaf =
    mentionPath.replace(/\/+$/u, '').split('/').filter(Boolean).pop()
    ?? mentionPath
  return {
    source: 'reference',
    ref: mention,
    label: kind === 'directory' ? `${leaf}/` : leaf,
    appearance: kind === 'directory' ? 'folder' : 'file',
    clipboardText: mention,
  }
}

/**
 * Resolve dropped directory Files into path refs via Desktop bridge.
 * Entries without a resolvable path are returned in `unresolved`.
 */
export function resolveDroppedDirectories(
  directories: readonly File[],
): {
  readonly resolved: readonly DroppedPathRef[]
  readonly unresolved: readonly File[]
} {
  const resolved: DroppedPathRef[] = []
  const unresolved: File[] = []
  for (const file of directories) {
    const path = desktopPathForFile(file)
    if (path === undefined) {
      unresolved.push(file)
      continue
    }
    resolved.push({ path, kind: 'directory' })
  }
  return { resolved, unresolved }
}
