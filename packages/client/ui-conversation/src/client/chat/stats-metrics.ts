// Pure session-stats folds and formatters shared by StatsLine (composer dock)
// and ContextMeter. No React — root vitest can gate these without jsdom.

import type { ConversationSnapshot } from '@xrkseek/client-runtime/client'
// Stub import: the client barrel touches `window` (slots); this module is
// unit-tested in Node, so it must not drag the barrel in.
import { isDecodableSample } from '@xrkseek/xrk-llm/message'
import type { ContextPressureProjection, TokenUsageProjection } from '@xrkseek/xrk-token-meter/client'
import { assistantStepReading } from './turn-metrics.ts'
import { formatCacheHitPercent } from './token-format.ts'

export interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/** Locale seat fragment used by compact duration strings. */
export type StatsDurationTranslate = (
  key: 'duration.compactSeconds' | 'duration.compactMinutes',
  params: Record<string, string | number>,
) => string

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && isDecodableSample(reading.outputTokens, reading.decodeMs)) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens ?? 0
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @param t - locale seat for compact duration strings.
 * @returns display string.
 */
export function formatDuration(ms: number, t: StatsDurationTranslate): string {
  const s = ms / 1_000
  if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 })
  const whole = Math.round(s)
  return t('duration.compactMinutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  })
}

/**
 * Display-ready cache-hit share of prompt-side input (DSH StatsPills parity).
 * Denominator is all billed prompt buckets: uncached + cache read + cache write.
 * @param usage - the session's token-usage projection value.
 * @returns percentage text, or null when there was no prompt input.
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  return formatCacheHitPercent(usage.cacheReadTokens, billedInputTokens(usage))
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

export interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
  /**
   * True when the numerator is heuristic breakdown (no provider usage yet).
   * Soft compact still uses denser local estimate; ring is approximate only.
   */
  approximate: boolean
}

export interface ContextBreakdownParts {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

/**
 * Meter panel rows reconciled to the ring numerator.
 *
 * System / tools stay heuristic (they match the timeline). Conversation
 * messages absorb `usedTokens − system − tools` so the three rows sum to the
 * provider ring (Codex / DSH: soft compact reads that ring, not chars/4 alone).
 * `residualTokens` is how far the raw message heuristic sat under that fill
 * (positive = undercount — the photo gap); negative means the heuristic was
 * already above the ring residual.
 */
export function contextBreakdownForMeter(
  breakdown: ContextBreakdownParts,
  usedTokens: number,
): ContextBreakdownParts & { readonly residualTokens: number } {
  const { systemTokens, toolsTokens, messageTokens } = breakdown
  const fixed = systemTokens + toolsTokens
  if (!(usedTokens >= fixed) || !Number.isFinite(usedTokens)) {
    return { systemTokens, toolsTokens, messageTokens, residualTokens: 0 }
  }
  const messagesForRing = Math.max(0, Math.floor(usedTokens - fixed))
  return {
    systemTokens,
    toolsTokens,
    messageTokens: messagesForRing,
    residualTokens: messagesForRing - messageTokens,
  }
}

/**
 * Context occupancy for the ContextMeter ring.
 *
 * Prefers provider projected/pressure (upstream). When the route has a
 * `contextWindow` but the provider never reported usage (no ring sample),
 * falls back to heuristic breakdown so custom / silent-usage models still
 * show an approximate ring — soft compact does not wait for usage either.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
  breakdown?: ContextBreakdownParts,
): ContextOccupancy | null {
  const contextWindow = pressure?.contextWindow
  if (contextWindow === undefined) return null
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens !== undefined) {
    return {
      percent: Math.min(100, Math.round(usedTokens / contextWindow * 100)),
      usedTokens,
      contextWindow,
      approximate: false,
    }
  }
  if (breakdown === undefined) return null
  const heuristic =
    breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  if (heuristic <= 0) return null
  return {
    percent: Math.min(100, Math.round(heuristic / contextWindow * 100)),
    usedTokens: heuristic,
    contextWindow,
    approximate: true,
  }
}
