/**
 * Voice × Lane projection for transcript rows (0.8 UX).
 *
 * Voice / Lane are **chrome ids only** — stamped as `data-voice` / `data-lane`
 * so DressingAvatarSvg (deferred) can mount the right seat look later.
 * Do not invent bubble dialects, alignment flips, or color skins from these ids.
 */

/** Who is speaking on the timeline (avatar seat when Dressing lands). */
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
 * Whether a durable `user/message` is human UI composer owned.
 * Mirrors protocol {@link isHumanUserMessageSource}: omit / `kind:"user"` only.
 * Seat · handoff · auto-continue · plugins are other producers — copy, not edit.
 */
export function isHumanOwnedUserMessage(source: unknown): boolean {
  if (source === undefined || source === null) return true
  const record = asRecord(source)
  if (record === null) return true
  const kind = readString(record, 'kind')
  return kind === null || kind === 'user'
}

/**
 * Coalesce / cover key aligned with kernel `steerSpeechFamilyKey`.
 * Boss steers share one key; handoff / seat / plugin stay separate so a stamped
 * boss durable must not retire a pending handoff 「插队中」 via text/media cover.
 */
export function speechFamilyKey(source: unknown): string {
  const record = asRecord(source)
  const kind = record === null ? null : readString(record, 'kind')
  if (kind === null || kind === 'user') return 'boss'
  const author = record === null
    ? ''
    : (readString(record, 'fromSessionId')
      ?? readString(record, 'peerSessionId')
      ?? readString(record, 'childSessionId')
      ?? '')
  if (kind === 'handoff') return `handoff:${author}`
  if (kind === 'seat') {
    const channel = readString(record!, 'channel')
    const role = channel === 'peer' ? 'peer' : 'delegator'
    return `seat:${role}:${author}`
  }
  if (kind === 'plugin') {
    const pluginId = readString(record!, 'pluginId') ?? readString(record!, 'plugin') ?? ''
    return `plugin:${pluginId}:${author}`
  }
  if (kind === 'auto-continue') return 'auto-continue'
  return `other:${kind}:${author}`
}

/**
 * Project durable `user/message.source` (and kind of row) onto Voice × Lane.
 *
 * Aligns with protocol {@link messageSpeechRole}:
 * boss→operator · delegator→seat · peer→peer · handoff→courier · else→runtime.
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
  // Surface-owned rows (this session's seat acting / speaking).
  if (surface === 'assistant') return { voice: 'seat', lane: 'open' }
  if (surface === 'tool') return { voice: 'seat', lane: 'act' }
  if (surface === 'compaction') return { voice: 'runtime', lane: 'brief' }
  if (surface === 'retry' || surface === 'turn-error') {
    return { voice: 'runtime', lane: 'ops' }
  }

  // Source wins for admitted rows even when surface is still user / steering / context.
  const record = asRecord(input.source)
  const kind = record === null ? null : readString(record, 'kind')
  const form = record === null ? null : readString(record, 'form')
  const plugin = record === null ? null : readString(record, 'plugin')
  const channel = record === null ? null : readString(record, 'channel')

  if (kind === 'session-reference' || form === 'recall') {
    return { voice: 'runtime', lane: 'recall' }
  }
  // First-class handoff / courier bags — never bare `form:notice`
  // (goals / other plugins also use notice and stay runtime×brief).
  // Includes legacy `plugin:subagent` and parent mirror leftovers.
  if (
    kind === 'handoff'
    || (kind === 'plugin' && plugin === 'subagent' && (form === 'notice' || form === null))
    || (kind === 'plugin' && plugin === 'subagent-mirror')
  ) {
    return { voice: 'courier', lane: 'handoff' }
  }
  // Live seat speech: 委派方 vs 协作对端 — chrome for their avatars, not 老板.
  if (kind === 'seat') {
    if (channel === 'peer') return { voice: 'peer', lane: 'wire' }
    return { voice: 'seat', lane: surface === 'steering' ? 'cutin' : 'open' }
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
