/**
 * Truncate oversized model-visible `tool/result` surfaces (DSH-aligned).
 * Appends a replacement `tool/result` for the same callId; log keeps the
 * original. `deriveMessages` / surface pricing fold to the latest per callId.
 */

import { readSessionEvents } from "./seq.js";
import type { MessageContent, SessionEvent, ToolResultEvent } from "@xrkseek/protocol";
import { estimateMessageContent } from "./surface-estimate.js";
import { findLatestCompaction } from "./compaction.js";
import type { SessionStore } from "./store.js";

/** DSH-aligned: prune when result text exceeds this many characters. */
export const TOOL_RESULT_PRUNE_THRESHOLD_CHARS = 8192;
export const TOOL_RESULT_PRUNE_HEAD_CHARS = 4096;
export const TOOL_RESULT_PRUNE_TAIL_CHARS = 1024;

/** `tool/result.meta` key: previous surface token price (for O(1) fold delta). */
export const TOOL_RESULT_PRUNE_META_PREV_TOKENS =
  "xrkPrunePreviousSurfaceTokens" as const;

export interface ToolResultPruneOptions {
  readonly thresholdChars?: number;
  readonly headChars?: number;
  readonly tailChars?: number;
  readonly now?: () => number;
  readonly turnId?: string;
  readonly stepId?: string;
}

export interface ToolResultPruneResult {
  readonly pruned: number;
}

function contentPlainText(content: MessageContent): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== "text") return undefined;
    parts.push(block.text);
  }
  return parts.join("\n");
}

export function pruneToolResultText(
  text: string,
  options: {
    readonly thresholdChars?: number;
    readonly headChars?: number;
    readonly tailChars?: number;
  } = {},
): string | undefined {
  const threshold = options.thresholdChars ?? TOOL_RESULT_PRUNE_THRESHOLD_CHARS;
  const headChars = options.headChars ?? TOOL_RESULT_PRUNE_HEAD_CHARS;
  const tailChars = options.tailChars ?? TOOL_RESULT_PRUNE_TAIL_CHARS;
  // DSH budgets are Unicode code points, not UTF-16 code units.
  const units = Array.from(text);
  if (units.length <= threshold) return undefined;
  if (headChars + tailChars >= units.length) return undefined;
  const omitted = units.length - headChars - tailChars;
  const head = units.slice(0, headChars).join("");
  const tail = units.slice(-tailChars).join("");
  return `${head}\n\n…[${omitted} chars omitted]…\n\n${tail}`;
}

function latestToolResultByCallId(
  events: readonly SessionEvent[],
  start: number,
): Map<string, ToolResultEvent> {
  const latest = new Map<string, ToolResultEvent>();
  for (let i = start; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.type === "tool/result") {
      latest.set(ev.result.toolCallId, ev);
    }
  }
  return latest;
}

/**
 * Append pruned replacement `tool/result` events for oversized results in the
 * current model window (after latest compaction). Idempotent when the latest
 * surface is already under threshold.
 */
export function pruneOversizedToolResults(
  store: SessionStore,
  sessionId: string,
  options: ToolResultPruneOptions = {},
): ToolResultPruneResult {
  const threshold = options.thresholdChars ?? TOOL_RESULT_PRUNE_THRESHOLD_CHARS;
  const headChars = options.headChars ?? TOOL_RESULT_PRUNE_HEAD_CHARS;
  const tailChars = options.tailChars ?? TOOL_RESULT_PRUNE_TAIL_CHARS;
  const now = options.now ?? Date.now;
  const events = readSessionEvents(store, sessionId);
  const latestCompaction = findLatestCompaction(events);
  const start = latestCompaction ? latestCompaction.index + 1 : 0;
  const latest = latestToolResultByCallId(events, start);

  let pruned = 0;
  for (const ev of latest.values()) {
    const plain = contentPlainText(ev.result.content);
    if (plain === undefined) continue;
    const next = pruneToolResultText(plain, {
      thresholdChars: threshold,
      headChars,
      tailChars,
    });
    if (next === undefined) continue;

    const previousSurfaceTokens = estimateMessageContent(ev.result.content);
    store.append(sessionId, {
      type: "tool/result",
      ts: now(),
      turnId: options.turnId ?? ev.turnId,
      stepId: options.stepId ?? ev.stepId,
      result: {
        toolCallId: ev.result.toolCallId,
        name: ev.result.name,
        content: next,
        ...(ev.result.isError ? { isError: true } : {}),
        meta: {
          ...(ev.result.meta ?? {}),
          [TOOL_RESULT_PRUNE_META_PREV_TOKENS]: previousSurfaceTokens,
        },
      },
    });
    pruned += 1;
  }
  return { pruned };
}
