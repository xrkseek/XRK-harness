import type {
  AssistantBlock, ConversationTimelineSnapshot, PartialAssistant,
} from '@xrkseek/client-runtime/client'

function blockHasVisibleContent(block: AssistantBlock): boolean {
  if (block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

/** Whether a streaming partial still has painter-visible Think/text (not tool-only). */
export function hasVisiblePartialContent(partial: PartialAssistant | null): boolean {
  return partial !== null && partial.blocks.some(blockHasVisibleContent)
}

/** Open-step streaming partial with visible Think/text; empty pre-token blocks are not live. */
export function isActiveStreamingPartial(
  partial: PartialAssistant | null,
  timeline: ConversationTimelineSnapshot,
): boolean {
  if (partial === null || !hasVisiblePartialContent(partial)) return false
  const turn = timeline.turns.get(partial.turn)
  if (turn === undefined || turn.status !== 'open') return false
  const step = turn.steps.find(item => item.step === partial.step)
  if (step !== undefined) return step.status === 'open'
  return true
}

/** In-flight tools or an open-step streaming partial — settled history is not live. */
export function hasActiveTurnSurface(
  partial: PartialAssistant | null,
  runningCallCount: number,
  timeline: ConversationTimelineSnapshot,
): boolean {
  if (runningCallCount > 0) return true
  return isActiveStreamingPartial(partial, timeline)
}

/**
 * Composer Stop follows Host `running` only. Optimistic cancel clears that
 * bit before in-flight tools / streaming tails settle; keeping Stop on
 * `runningCalls` / partial made pause look late while the session list was
 * already idle. Selected as one boolean so InputBar does not re-render on
 * every assistant chunk (partial identity changes each animation-frame flush).
 */
export function isComposerAgentActive(input: {
  readonly running: boolean
  readonly runningCallCount: number
  readonly partial: PartialAssistant | null
}): boolean {
  void input.runningCallCount
  void input.partial
  return input.running
}

/**
 * Flow-tail waiting (`turnStatus.*`), DSH-aligned with drain `running` + live surface:
 * show in vacuum (pre-Think, step gap, steer queue/tail); hide during tools or live Think.
 *
 * Prefer the precomputed `turnSurfaceActive` latch when callers already selected
 * it (avoids re-deriving from a per-chunk `partial` identity in ChatView).
 */
export function shouldShowFlowWaiting(input: {
  readonly running: boolean
  readonly pendingSteerCount: number
  readonly tailKind: string | undefined
  readonly turnSurfaceActive: boolean
  readonly turnOpen?: boolean
  /** True when the timeline has turns and none of them are still open. */
  readonly turnsSettled?: boolean
} | {
  readonly running: boolean
  readonly partial: PartialAssistant | null
  readonly runningCallCount: number
  readonly timeline: ConversationTimelineSnapshot
  readonly pendingSteerCount: number
  readonly tailKind: string | undefined
  readonly turnOpen?: boolean
  readonly turnsSettled?: boolean
}): boolean {
  if (!input.running) return false
  if (input.pendingSteerCount > 0) return true
  if (input.turnsSettled) return false
  if (input.tailKind === 'steering') return true
  const surfaceActive = 'turnSurfaceActive' in input
    ? input.turnSurfaceActive
    : hasActiveTurnSurface(input.partial, input.runningCallCount, input.timeline)
  return !surfaceActive
}
