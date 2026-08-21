/**
 * O(1) surface-token fold (DSH foldSurfaceProjection adapted to XRK events).
 *
 * Appends price model-visible messages. `context/compaction` with
 * `shadowedTokenCount` applies signed delta:
 *   estimate(formatCompactionForModel) − shadowedTokenCount
 * Legacy compaction without the field folds at 0 (DSH replace-without-claim).
 *
 * Pruned `tool/result` replacements carry
 * `meta.xrkPrunePreviousSurfaceTokens` so the fold can apply a net delta
 * without re-scanning the log.
 */

import type { ContextCompactionEvent, SessionEvent, ToolResultEvent } from "@xrkseek/protocol";
import { formatCompactionForModel, findLatestCompaction } from "./compaction.js";
import {
  estimateAssistantSurface,
  estimateMessageContent,
} from "./surface-estimate.js";
import { TOOL_RESULT_PRUNE_META_PREV_TOKENS } from "./tool-result-prune.js";

/** Append-only surface price (excludes compaction). */
function appendSurfaceDelta(event: SessionEvent): number {
  switch (event.type) {
    case "user/message":
    case "safety/notice":
      return estimateMessageContent(event.content);
    case "assistant/message":
      return estimateAssistantSurface(event.content, event.toolCalls);
    case "tool/result":
      return toolResultSurfaceDelta(event);
    default:
      return 0;
  }
}

function toolResultSurfaceDelta(event: ToolResultEvent): number {
  const next = estimateMessageContent(event.result.content);
  const prevRaw = event.result.meta?.[TOOL_RESULT_PRUNE_META_PREV_TOKENS];
  if (typeof prevRaw === "number" && Number.isFinite(prevRaw)) {
    return next - prevRaw;
  }
  return next;
}

/** Checkpoint price after a compaction window swap (one synthetic user message). */
function estimateCompactionCheckpoint(
  event: ContextCompactionEvent,
): number {
  return estimateMessageContent(formatCompactionForModel(event));
}

/**
 * Signed change for one compaction event.
 * Missing `shadowedTokenCount` → 0 (historical / incomplete producer).
 */
function compactionSurfaceDelta(event: ContextCompactionEvent): number {
  if (event.shadowedTokenCount === undefined) return 0;
  return estimateCompactionCheckpoint(event) - event.shadowedTokenCount;
}

function surfaceDeltaFor(event: SessionEvent): number {
  if (event.type === "context/compaction") {
    return compactionSurfaceDelta(event);
  }
  return appendSurfaceDelta(event);
}

export function foldSurfaceTokens(
  surfaceTokens: number,
  event: SessionEvent,
): number {
  const delta = surfaceDeltaFor(event);
  if (delta === 0) return surfaceTokens;
  return Math.max(0, surfaceTokens + delta);
}

/**
 * Heuristic price of the current model window's append surface
 * (events after the latest compaction, or from 0).
 * Uses the latest `tool/result` per callId (prune replacements).
 * Used by compaction producers as `shadowedTokenCount`.
 */
export function priceCurrentSurfaceWindow(
  events: readonly SessionEvent[],
): number {
  const latest = findLatestCompaction(events);
  const start = latest ? latest.index + 1 : 0;
  let tokens = 0;
  const seenToolResults = new Set<string>();
  // Walk newest-first so the first tool/result per callId is the surface.
  for (let i = events.length - 1; i >= start; i--) {
    const ev = events[i]!;
    if (ev.type === "tool/result") {
      if (seenToolResults.has(ev.result.toolCallId)) continue;
      seenToolResults.add(ev.result.toolCallId);
      tokens += estimateMessageContent(ev.result.content);
      continue;
    }
    if (ev.type === "context/compaction") continue;
    tokens += appendSurfaceDelta(ev);
  }
  return tokens;
}
