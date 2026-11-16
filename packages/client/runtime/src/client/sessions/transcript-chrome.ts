/**
 * Voice × Lane projection for transcript rows (0.8 UX).
 * Avatars / DressingAvatarSvg are deferred — this module only stamps chrome ids.
 */

/** Who is speaking on the timeline. */
export type TranscriptVoice =
  | 'operator'
  | 'seat'
  | 'courier'
  | 'peer'
  | 'runtime'

/** What kind of beat this row is. */
export type TranscriptLane =
  | 'open'
  | 'cutin'
  | 'act'
  | 'handoff'
  | 'wire'
  | 'brief'
  | 'recall'
  | 'ops'

/** Projected chrome for DOM `data-voice` / `data-lane`. */
export interface TranscriptChrome {
  readonly voice: TranscriptVoice
  readonly lane: TranscriptLane
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Project durable `user/message.source` (and kind of row) onto Voice × Lane.
 *
 * @param input.source - logged source bag (opaque JSON)
 * @param input.surface - which transcript surface is rendering
 */
export function projectTranscriptChrome(input: {
  readonly source?: unknown
  readonly surface:
    | 'user'
    | 'steering'
    | 'context'
    | 'assistant'
    | 'tool'
    | 'compaction'
    | 'retry'
    | 'turn-error'
}): TranscriptChrome {
  const { surface } = input
  if (surface === 'assistant') return { voice: 'seat', lane: 'open' }
  if (surface === 'tool') return { voice: 'seat', lane: 'act' }
  if (surface === 'compaction') return { voice: 'runtime', lane: 'brief' }
  if (surface === 'retry' || surface === 'turn-error') {
    return { voice: 'runtime', lane: 'ops' }
  }

  // Source wins for admitted rows (courier notice, peer relay, auto-continue)
  // even when the surface is still user / steering / context.
  const record = asRecord(input.source)
  const kind = record === null ? null : readString(record, 'kind')
  const form = record === null ? null : readString(record, 'form')
  const plugin = record === null ? null : readString(record, 'plugin')

  if (kind === 'session-reference' || form === 'recall') {
    return { voice: 'runtime', lane: 'recall' }
  }
  if (
    form === 'notice'
    || (kind === 'plugin' && plugin === 'subagent')
  ) {
    return { voice: 'courier', lane: 'handoff' }
  }
  if (form === 'relay') {
    return { voice: 'peer', lane: 'wire' }
  }
  if (kind === 'auto-continue') {
    return { voice: 'runtime', lane: 'ops' }
  }
  if (
    kind === 'skill-catalog'
    || kind === 'agent-instructions'
    || kind === 'skill-invocation'
    || kind === 'context-fragment'
    || kind === 'tool-registry'
    || kind === 'plugin'
  ) {
    return { voice: 'runtime', lane: 'brief' }
  }

  if (surface === 'steering') return { voice: 'operator', lane: 'cutin' }
  if (surface === 'user') return { voice: 'operator', lane: 'open' }
  return { voice: 'runtime', lane: 'brief' }
}
