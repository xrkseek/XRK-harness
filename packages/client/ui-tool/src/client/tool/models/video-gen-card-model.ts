/**
 * Display helpers for `video_generate` text results (no in-chat video player).
 */
import type { ToolCallBlock } from './tool-call-model.ts'
import { resultText } from './tool-call-model.ts'
import {
  parseVideoGenResultText,
  type ParsedVideoGenResult,
} from './gen-result-parse.ts'

export type { ParsedVideoGenResult }

/**
 * Parse a settled `video_generate` result for row summary / cleaned output.
 * Returns null while running or when the call is not video_generate.
 */
export function videoGenResultModel(block: ToolCallBlock): ParsedVideoGenResult | null {
  if (!('kind' in block)) return null
  const callName = block.call?.name
  if (callName !== undefined && callName !== 'video_generate') return null
  return parseVideoGenResultText(resultText(block))
}

/** Truncate prompt / command text for the collapsed summary. */
export function truncateGenSummary(text: string, max = 72): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, Math.max(1, max - 1))}…`
}
