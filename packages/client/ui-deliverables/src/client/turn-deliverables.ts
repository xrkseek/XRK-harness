/**
 * Turn-scoped produced-file + workspace-changes Definition and readers.
 * Client-only and model-free: mutation `locations` for produced chips;
 * embedded `workspace/changes` summary for the changed-files card.
 */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@xrkseek/client-runtime/client'
import { isAppendSurfaceEvent } from '@xrkseek/client-runtime/client'
import type { MarkdownFileMentions } from '@xrkseek/client-ui-primitives'
import type { TurnTailOwnerProps } from '@xrkseek/client-ui-conversation/client'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** One changed-file row carried on the turn card (from the SessionEvent summary). */
export interface ChangesFileRow {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

/** Latest `workspace/changes` announcement for one Turn (Face seq for fileDiff). */
export interface ChangesTurnData {
  readonly seq: number
  readonly turnId: string
  readonly cwd: string
  readonly files: readonly ChangesFileRow[]
  readonly total: number
  readonly added: number
  readonly deleted: number
}

/** Immutable produced-file + changes facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  readonly changes?: ChangesTurnData
}

declare module '@xrkseek/client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths and turn-end workspace changes for this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolResultNode['callView']>
}

function producedPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}

function isChangesWireData(data: unknown): data is {
  readonly turn: number
  readonly turnId: string
  readonly summary: {
    readonly turnId: string
    readonly cwd: string
    readonly files: readonly ChangesFileRow[]
    readonly total: number
    readonly added: number
    readonly deleted: number
  }
} {
  if (!data || typeof data !== 'object') return false
  const row = data as Record<string, unknown>
  if (typeof row.turn !== 'number' || !Number.isSafeInteger(row.turn)) return false
  if (typeof row.turnId !== 'string') return false
  const summary = row.summary
  if (!summary || typeof summary !== 'object') return false
  const s = summary as Record<string, unknown>
  return typeof s.cwd === 'string'
    && Array.isArray(s.files)
    && typeof s.total === 'number'
    && typeof s.added === 'number'
    && typeof s.deleted === 'number'
}

/** Files produced by one Turn data value (paths before the closing seq). */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/** Turn-end changes announcement at or before the closing seq. */
export function changesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): ChangesTurnData | null {
  if (data?.changes === undefined || data.changes.seq > seq) return null
  if (data.changes.files.length === 0) return null
  return data.changes
}

/** Match for the combined turn-tail deliverables entry. */
export interface DeliverablesMatch {
  readonly changes: ChangesTurnData | null
  readonly produced: readonly string[]
}

/**
 * Claim the turn-tail chain when the closing turn announced changes or produced files.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const data = owner.turn.data.get('deliverables')
  const changes = changesForClosing(data, owner.seq)
  const produced = producedForClosing(data, owner.seq)
  return changes === null && produced.length === 0
    ? null
    : { changes, produced }
}

/** @deprecated Prefer {@link selectDeliverables}; kept for produced-only tests. */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Turn-local successful mutation + workspace/changes accumulator. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'workspace/changes' && isChangesWireData(event.data)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'workspace/changes' && isChangesWireData(match.event.data)) {
      const { summary } = match.event.data
      return {
        ...context.state,
        changes: {
          seq: match.event.seq,
          turnId: match.event.data.turnId,
          cwd: summary.cwd,
          files: summary.files,
          total: summary.total,
          added: summary.added,
          deleted: summary.deleted,
        },
      }
    }
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        match.view?.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = producedPaths(context.state.calls.get(callId) ?? null)
      .map(path => ({ seq: match.event.seq, path }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: {
        produced: context.state.produced,
        ...(context.state.changes !== undefined ? { changes: context.state.changes } : {}),
      },
    },
}

export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value: string) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
