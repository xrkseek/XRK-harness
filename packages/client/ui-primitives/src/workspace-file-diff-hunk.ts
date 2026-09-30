/**
 * Rebuild DiffBlock texts from a coarse Face-style file diff
 * (`WorkspaceFileDiff` wire). Cordis/CSS-free for Node vitest.
 */
import type { DiffHunk } from './DiffBlock.tsx'

/** Minimal Face `changes/fileDiff` text payload (no remotes import). */
export type CoarseWorkspaceFileDiff = {
  readonly kind: 'text' | 'binary' | 'oversized'
  readonly path: string
  readonly before?: boolean
  readonly after?: boolean
  readonly hunks?: readonly { readonly lines: readonly string[] }[]
}

/** Map Face fileDiff → {@link DiffHunk}; null when not a text comparison. */
export function diffHunkFromWorkspaceFileDiff(
  diff: CoarseWorkspaceFileDiff,
): DiffHunk | null {
  if (diff.kind !== 'text') return null
  const hunks = diff.hunks ?? []
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const body = line.slice(1)
      if (line.startsWith('-')) oldLines.push(body)
      else if (line.startsWith('+')) newLines.push(body)
      else {
        oldLines.push(body)
        newLines.push(body)
      }
    }
  }
  return {
    path: diff.path,
    oldText: diff.before
      ? `${oldLines.join('\n')}${oldLines.length > 0 ? '\n' : ''}`
      : null,
    // Mirror Face `after`: deleted files feed DiffBlock an empty added side.
    newText: diff.after
      ? `${newLines.join('\n')}${newLines.length > 0 ? '\n' : ''}`
      : '',
  }
}
