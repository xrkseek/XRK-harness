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

function isPostToolVacuum(tailKind: string | undefined): boolean {
  return tailKind === 'tool-call' || tailKind === 'tool-result'
}

function isHumanTail(tailKind: string | undefined): boolean {
  return tailKind === 'user' || tailKind === 'steering'
}

function surfaceActiveOf(input: {
  readonly turnSurfaceActive: boolean
} | {
  readonly partial: PartialAssistant | null
  readonly runningCallCount: number
  readonly timeline: ConversationTimelineSnapshot
}): boolean {
  return 'turnSurfaceActive' in input
    ? input.turnSurfaceActive
    : hasActiveTurnSurface(input.partial, input.runningCallCount, input.timeline)
}

/** Host is still going, but the user already has the finished answer on screen. */
function settledIdle(input: {
  readonly turnsSettled?: boolean
  readonly pendingSendCount?: number
  readonly tailKind: string | undefined
}): boolean {
  if (input.turnsSettled !== true) return false
  if ((input.pendingSendCount ?? 0) > 0) return false
  if (isPostToolVacuum(input.tailKind)) return false
  return !isHumanTail(input.tailKind)
}

/**
 * Flow-tail waiting (`turnStatus.*`): the user is waiting and the flow shows
 * no new agent follow-up (pre-Think, tool finished, just sent). Hide while
 * they can watch tools or live Think/text, and hide Host running-lag after
 * a closed turn with nothing new from the human.
 */
export function shouldShowFlowWaiting(input: {
  readonly running: boolean
  readonly tailKind: string | undefined
  readonly runningCallCount?: number
  readonly skippedTrailingRunningStep?: boolean
  readonly turnsSettled?: boolean
  readonly pendingSendCount?: number
  readonly turnSurfaceActive: boolean
} | {
  readonly running: boolean
  readonly partial: PartialAssistant | null
  readonly runningCallCount: number
  readonly timeline: ConversationTimelineSnapshot
  readonly tailKind: string | undefined
  readonly skippedTrailingRunningStep?: boolean
  readonly turnsSettled?: boolean
  readonly pendingSendCount?: number
}): boolean {
  if (!input.running) return false
  if ((input.runningCallCount ?? 0) > 0) return false
  const surfaceActive = surfaceActiveOf(input)
  // Running assistant-step after the last durable row is live Think/text.
  if (input.skippedTrailingRunningStep === true && surfaceActive) return false
  if (settledIdle(input)) return false
  // Leftover Think above a settled tool, or a human line at the tail, is not
  // new agent work — the user is staring at a gap.
  if (isPostToolVacuum(input.tailKind) && input.skippedTrailingRunningStep !== true) return true
  if (isHumanTail(input.tailKind)) return true
  return !surfaceActive
}
