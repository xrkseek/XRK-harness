import type {
  AssistantBlock, ConversationTimelineSnapshot, PartialAssistant,
} from '@xrkseek/client-runtime/client'

function blockHasVisibleContent(block: AssistantBlock): boolean {
  if (block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

/** Open-step streaming partial with visible Think/text; empty pre-token blocks are not live. */
export function isActiveStreamingPartial(
  partial: PartialAssistant | null,
  timeline: ConversationTimelineSnapshot,
): boolean {
  if (partial === null || !partial.blocks.some(blockHasVisibleContent)) return false
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
 * Flow-tail waiting (`turnStatus.*`), DSH-aligned with drain `running` + live surface:
 * show in vacuum (pre-Think, step gap, steer queue/tail); hide during tools or live Think.
 */
export function shouldShowFlowWaiting(input: {
  readonly running: boolean
  readonly partial: PartialAssistant | null
  readonly runningCallCount: number
  readonly timeline: ConversationTimelineSnapshot
  readonly pendingSteerCount: number
  readonly tailKind: string | undefined
}): boolean {
  if (!input.running) return false
  if (input.pendingSteerCount > 0) return true
  if (input.tailKind === 'steering') return true
  return !hasActiveTurnSurface(input.partial, input.runningCallCount, input.timeline)
}
