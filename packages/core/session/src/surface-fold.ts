/**
 * O(1) surface-token fold (DSH foldSurfaceProjection adapted to XRK events).
 *
 * Appends price model-visible messages. `context/compaction` with
 * `shadowedTokenCount` applies signed delta:
 *   estimate(formatCompactionForModel) − shadowedTokenCount
 * Legacy compaction without the field folds at 0 (DSH replace-without-claim).
 */

import type { ContextCompactionEvent, SessionEvent } from "@xrkseek/protocol";
import { formatCompactionForModel, findLatestCompaction } from "./compaction.js";
import {
  estimateAssistantSurface,
  estimateMessageContent,
} from "./surface-estimate.js";

/** Append-only surface price (excludes compaction). */
function appendSurfaceDelta(event: SessionEvent): number {
  switch (event.type) {
    case "user/message":
    case "safety/notice":
      return estimateMessageContent(event.content);
    case "assistant/message":
      return estimateAssistantSurface(event.content, event.toolCalls);
    case "tool/result":
      return estimateMessageContent(event.result.content);
    default:
      return 0;
  }
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
 * Used by compaction producers as `shadowedTokenCount`.
 */
export function priceCurrentSurfaceWindow(
  events: readonly SessionEvent[],
): number {
  const latest = findLatestCompaction(events);
  const start = latest ? latest.index + 1 : 0;
  let tokens = 0;
  for (let i = start; i < events.length; i++) {
    tokens += appendSurfaceDelta(events[i]!);
  }
  return tokens;
}
