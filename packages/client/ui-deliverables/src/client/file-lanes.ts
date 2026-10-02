/**
 * Classify turn-tail file chips into created / modified / deleted lanes.
 * Last mutation per path wins; a later delete drops the path from created/modified.
 */

import type { FileDiff } from '@xrkseek/protocol'
import type { ToolResultNode } from '@xrkseek/client-runtime/client'
import type { ChangesFileRow, DeliverablesTurnData } from './turn-deliverables.ts'

/** One mutation recorded against a path during the Turn. */
export type FileLaneOp = 'create' | 'modify' | 'delete'

export interface FileLaneMutation {
  readonly seq: number
  readonly path: string
  readonly op: FileLaneOp
}

/** Three turn-tail chip lanes (empty arrays omitted by the renderer). */
export interface FileLanes {
  readonly created: readonly string[]
  readonly modified: readonly string[]
  readonly deleted: readonly string[]
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Classify one FileDiff side-pair (protocol / DiffCallView). */
export function opFromFileDiff(diff: FileDiff): FileLaneOp {
  if (diff.oldText === null) return 'create'
  if (diff.newText === '') return 'delete'
  return 'modify'
}

/** Mutations from a call/result tool view (empty when the view is not a mutator). */
export function mutationsFromToolView(
  view: ToolResultNode['callView'] | ToolResultNode['resultView'],
  seq: number,
): readonly FileLaneMutation[] {
  if (view === null || view === undefined) return []
  if (view.card === 'diff') {
    const diffs = 'diffs' in view ? view.diffs : undefined
    if (!diffs) return []
    return diffs.map(diff => ({
      seq,
      path: normalizePath(diff.path),
      op: opFromFileDiff(diff),
    }))
  }
  if (view.card === 'generic') {
    const locations = view.locations ?? []
    if (view.kind === 'delete') {
      return locations.map(location => ({
        seq,
        path: normalizePath(location.path),
        op: 'delete' as const,
      }))
    }
    if (view.kind === 'edit') {
      return locations.map(location => ({
        seq,
        path: normalizePath(location.path),
        op: 'modify' as const,
      }))
    }
  }
  return []
}

/**
 * Fold mutations in seq order: last op per path wins.
 * A final delete never appears under created/modified (even if created earlier).
 */
export function foldFileLanes(mutations: readonly FileLaneMutation[]): FileLanes {
  const last = new Map<string, FileLaneOp>()
  const order: string[] = []
  for (const row of mutations) {
    if (!row.path) continue
    if (!last.has(row.path)) order.push(row.path)
    last.set(row.path, row.op)
  }
  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const path of order) {
    const op = last.get(path)
    if (op === 'create') created.push(path)
    else if (op === 'modify') modified.push(path)
    else if (op === 'delete') deleted.push(path)
  }
  return { created, modified, deleted }
}

/**
 * Fallback when only the workspace/changes summary is available (cold reopen).
 * Line-count heuristic: zero-add + deletes → delete; zero-delete + adds → create; else modify.
 */
export function lanesFromChangesFiles(files: readonly ChangesFileRow[]): FileLanes {
  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const file of files) {
    const path = normalizePath(file.path)
    if (file.added === 0 && file.deleted > 0) deleted.push(path)
    else if (file.deleted === 0 && file.added > 0) created.push(path)
    else modified.push(path)
  }
  return { created, modified, deleted }
}

/**
 * Prefer mutation stream on {@link DeliverablesTurnData.produced}; fall back to
 * the changes summary when no mutation ops were recorded.
 */
export function fileLanesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): FileLanes {
  if (data === undefined) return { created: [], modified: [], deleted: [] }
  const mutations = data.produced.filter(row => row.seq <= seq && row.op !== undefined) as FileLaneMutation[]
  if (mutations.length > 0) return foldFileLanes(mutations)
  // Legacy rows without `op` (older sessions): treat as create unless changes says deleted.
  const legacy = data.produced.filter(row => row.seq <= seq && row.op === undefined)
  if (legacy.length > 0) {
    const deletedPaths = new Set(
      (data.changes?.seq !== undefined && data.changes.seq <= seq
        ? data.changes.files.filter(f => f.added === 0 && f.deleted > 0)
        : []
      ).map(f => normalizePath(f.path)),
    )
    const created: string[] = []
    const seen = new Set<string>()
    for (const row of legacy) {
      const path = normalizePath(row.path)
      if (seen.has(path) || deletedPaths.has(path)) continue
      seen.add(path)
      created.push(path)
    }
    const deleted = [...deletedPaths]
    const modified = (data.changes?.seq !== undefined && data.changes.seq <= seq
      ? data.changes.files
      : []
    )
      .map(f => normalizePath(f.path))
      .filter(path => !seen.has(path) && !deletedPaths.has(path))
    return { created, modified, deleted }
  }
  if (data.changes !== undefined && data.changes.seq <= seq) {
    return lanesFromChangesFiles(data.changes.files)
  }
  return { created: [], modified: [], deleted: [] }
}
