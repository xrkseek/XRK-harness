/**
 * Directory-scoped `.gitignore` stack for workspace file search.
 * Learned from Codex `file-search` (`ignore::WalkBuilder` + `require_git`):
 * honor ignore files only inside a git working tree; nest rules per directory.
 */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/** One `.gitignore` / exclude file scoped to a relative directory prefix. */
export interface GitIgnoreLayer {
  /** Relative directory from workspace root, `""` for root, no trailing slash. */
  readonly base: string
  readonly matcher: Ignore
}

/**
 * Detect a git working tree (directory or worktree `.git` file).
 * When absent, gitignore files are not applied (Codex `require_git` semantics).
 */
export async function workspaceHasGit(root: string): Promise<boolean> {
  try {
    const status = await lstat(join(root, '.git'))
    return status.isDirectory() || status.isFile()
  } catch {
    return false
  }
}

/** Load ignore rules from a file; returns undefined when missing/unreadable. */
export async function loadIgnoreFile(absolutePath: string): Promise<Ignore | undefined> {
  try {
    const text = await readFile(absolutePath, 'utf8')
    const matcher = ignore()
    matcher.add(text)
    return matcher
  } catch {
    return undefined
  }
}

/**
 * Build root layers for one workspace: optional `.git/info/exclude` then
 * root `.gitignore`. Call only when {@link workspaceHasGit} is true.
 */
export async function loadRootGitIgnoreLayers(root: string): Promise<readonly GitIgnoreLayer[]> {
  const layers: GitIgnoreLayer[] = []
  const exclude = await loadIgnoreFile(join(root, '.git', 'info', 'exclude'))
  if (exclude) layers.push({ base: '', matcher: exclude })
  const rootIgnore = await loadIgnoreFile(join(root, '.gitignore'))
  if (rootIgnore) layers.push({ base: '', matcher: rootIgnore })
  return layers
}

/**
 * Append a directory's `.gitignore` (if any) onto the parent layer stack.
 * @param absoluteDir - absolute path of the directory being entered
 * @param relativeDir - path relative to workspace root (`""` at root)
 * @param parent - layers inherited from ancestors
 */
export async function pushDirectoryGitIgnore(
  absoluteDir: string,
  relativeDir: string,
  parent: readonly GitIgnoreLayer[],
): Promise<readonly GitIgnoreLayer[]> {
  // Root `.gitignore` is already loaded in {@link loadRootGitIgnoreLayers}.
  if (relativeDir === '') return parent
  const local = await loadIgnoreFile(join(absoluteDir, '.gitignore'))
  if (!local) return parent
  return [...parent, { base: relativeDir, matcher: local }]
}

/**
 * Whether a workspace-relative path is ignored by nested gitignore layers.
 * Lower (deeper) layers override ancestors, including `!` un-ignore rules.
 */
export function isGitIgnored(
  relativePath: string,
  isDirectory: boolean,
  layers: readonly GitIgnoreLayer[],
): boolean {
  if (relativePath.length === 0 || layers.length === 0) return false
  const normalized = relativePath.replaceAll('\\', '/')
  let ignored = false
  for (const layer of layers) {
    const local =
      layer.base === ''
        ? normalized
        : normalized === layer.base || normalized.startsWith(`${layer.base}/`)
          ? normalized === layer.base
            ? '.'
            : normalized.slice(layer.base.length + 1)
          : undefined
    if (local === undefined || local === '.' || local.length === 0) continue
    const testPath = isDirectory && !local.endsWith('/') ? `${local}/` : local
    const verdict = layer.matcher.test(testPath)
    if (verdict.ignored) ignored = true
    if (verdict.unignored) ignored = false
  }
  return ignored
}
