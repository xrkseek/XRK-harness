/**
 * Context compaction helpers — window swap, never delete the log.
 * LLM call lives in agent-loop (`runCompaction`); this module stays I/O-light.
 * @see docs/session-compaction.md
 */

import type {
  ChatMessage,
  ContextCompactionEvent,
  MessageContent,
  SessionEvent,
} from "@xrkseek/protocol";
import { flattenText } from "@xrkseek/protocol";
import { estimateImageTokens } from "@xrkseek/attachment";
import { estimateText } from "./surface-estimate.js";
import {
  foldImageOffloadMarks,
  projectOffloadedImages,
} from "./image-offload.js";

/**
 * Default keep/buffer for auto-compact when a caller does not pass explicit
 * tokens. Aligned with the Face product defaults (`settings-schemas.ts`
 * `keepTokens: 24_000`, `bufferTokens: 4_000`) — two independent "default
 * numbers" (8k/2k here vs 24k/4k in Face) silently desync'd runtime behavior
 * from the Settings UI. Keep them in sync whenever the schema default moves.
 */
export const DEFAULT_COMPACTION_KEEP_TOKENS = 24_000;
export const DEFAULT_COMPACTION_BUFFER_TOKENS = 4_000;
/** Soft-budget auto-compact attempts before fail-closed (DSH-style remeasure loop). */
export const DEFAULT_SOFT_BUDGET_COMPACT_ATTEMPTS = 2;

/**
 * Budget estimator for `selectHeadRecent` / overflow (`chars/4` via {@link estimateText}).
 */
export function estimateTokens(text: string): number {
  return estimateText(text);
}

function messagePlainText(m: ChatMessage): string {
  if (m.role === "tool") return flattenText(m.content);
  if (m.role === "assistant") return flattenText(m.content ?? "");
  return flattenText(m.content);
}

/**
 * Blocks that {@link flattenText} skips (images) or under-prices relative to the
 * outbound wire — soft budget must not miss them (漏压).
 * Image blocks use DeepSeek V41-aligned vision tokens from attachment dims
 * (provider usage remains authoritative after the turn).
 */
function estimateOpaqueContentBlocks(content: MessageContent): number {
  if (typeof content === "string") return 0;
  let n = 0;
  for (const block of content) {
    if (block.type === "text") continue;
    if (block.type === "image") {
      if (block.offloaded === true) continue;
      const { width, height } = block.attachment;
      if (
        Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0
      ) {
        n += estimateImageTokens(width, height);
      } else {
        n += estimateTokens(JSON.stringify(block.attachment));
      }
      continue;
    }
    if (block.type === "file") continue;
    n += estimateTokens(JSON.stringify(block));
  }
  return n;
}

export function estimateMessagesTokens(
  messages: readonly ChatMessage[],
): number {
  let n = 0;
  for (const m of messages) {
    n += estimateTokens(messagePlainText(m));
    if (m.role === "assistant" && m.reasoning?.trim()) {
      // On the wire as reasoning_content; flattenText never sees it.
      n += estimateTokens(m.reasoning);
    }
    if (m.role === "user" || m.role === "tool") {
      n += estimateOpaqueContentBlocks(m.content);
    }
    if (m.role === "assistant" && m.toolCalls) {
      for (const c of m.toolCalls) {
        n += estimateTokens(c.name);
        n += estimateTokens(JSON.stringify(c.arguments ?? {}));
      }
    }
  }
  return n;
}

/**
 * Soft-budget / overflow estimator for one outbound LLM request:
 * message surface + standing tool schemas (system is already a message on
 * the assemble path; tools were previously omitted and could bypass soft compact).
 */
export function estimateRequestTokens(input: {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  }[];
  readonly system?: string;
}): number {
  let n = estimateMessagesTokens(input.messages);
  // Non-assemble callers may pass system only on the side; avoid double-count
  // when the same text is already any system message (leading or in-history
  // trailing append).
  if (input.system?.trim()) {
    const alreadyCounted = input.messages.some(
      (m) => m.role === "system" && messagePlainText(m) === input.system,
    );
    if (!alreadyCounted) {
      n += estimateTokens(input.system);
    }
  }
  if (input.tools?.length) {
    n += estimateTokens(JSON.stringify(input.tools));
  }
  return n;
}

/**
 * Inclusive soft-budget allow ceiling: `maxRequestTokens − buffer`.
 * A buffer ≥ max would yield a non-positive ceiling and fail-closed every
 * non-empty turn (误杀) — treat that misconfig as buffer 0.
 */
export function resolveSoftBudgetCeiling(
  maxRequestTokens: number,
  bufferTokens: number,
): number {
  const max = Math.max(0, Math.trunc(maxRequestTokens));
  let buffer = Math.max(0, Math.trunc(bufferTokens));
  if (buffer >= max) buffer = 0;
  return max - buffer;
}

export const COMPACTION_SUMMARY_TEMPLATE = `Output exactly this Markdown structure (keep section order). Do not mention that context was compacted.

## Objective
- [what the user is trying to accomplish, or "(none)"]

## Decisions
- [constraints, choices and why, or "(none)"]

## State
### Done
- [finished work / verified facts, or "(none)"]
### Active
- [current work / partial state, or "(none)"]
### Blocked
- [blockers / unknowns, or "(none)"]

## Next
1. [immediate next action, or "(none)"]

## Files
- [path: why it matters, or "(none)"]`;

function serializeMessage(m: ChatMessage): string {
  if (m.role === "user") return `[User]: ${flattenText(m.content)}`;
  if (m.role === "assistant") {
    const parts = [`[Assistant]: ${m.content}`];
    if (m.reasoning?.trim()) {
      parts.push(`[Reasoning]: ${m.reasoning}`);
    }
    if (m.toolCalls?.length) {
      for (const c of m.toolCalls) {
        parts.push(
          `[Tool call]: ${c.name}(${JSON.stringify(c.arguments ?? {})})`,
        );
      }
    }
    return parts.join("\n");
  }
  if (m.role === "tool") {
    const text = flattenText(m.content);
    const body =
      text.length > 2_000 ? `${text.slice(0, 2_000)}\n[truncated]` : text;
    return `[Tool result ${m.name}]: ${body}`;
  }
  if (m.role === "system") return `[System]: ${m.content}`;
  return "";
}

/**
 * Split conversation into summarized head vs kept recent (from the end).
 */
export function selectHeadRecent(
  messages: readonly ChatMessage[],
  keepTokens: number,
):
  | {
      readonly head: string;
      readonly recent: string;
      readonly headMessageCount: number;
    }
  | undefined {
  const lines = messages.map(serializeMessage).filter(Boolean);
  if (lines.length === 0) return undefined;

  let total = 0;
  let split = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = total + estimateTokens(lines[i]!);
    if (next > keepTokens) {
      split = i + 1;
      break;
    }
    total = next;
    split = i;
  }

  return {
    head: lines.slice(0, split).join("\n\n"),
    recent: lines.slice(split).join("\n\n"),
    headMessageCount: split,
  };
}

export function buildCompactionPrompt(input: {
  readonly previousSummary?: string;
  readonly head: string;
}): string {
  const lead = input.previousSummary
    ? `Update the anchored summary below using the conversation history.\nPreserve still-true details, drop stale ones, merge new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
    : "Create a new anchored summary from the conversation history.";
  return [lead, COMPACTION_SUMMARY_TEMPLATE, input.head]
    .filter(Boolean)
    .join("\n\n");
}

export function formatCompactionForModel(
  event: ContextCompactionEvent,
): string {
  const recent = event.recent.trim()
    ? `\n\n## Recent\n${event.recent}`
    : "";
  return `[context compacted · ${event.reason}]\n## Summary\n${event.summary}${recent}`;
}

export function findLatestCompaction(
  events: readonly SessionEvent[],
): { readonly index: number; readonly event: ContextCompactionEvent } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "context/compaction") {
      return { index: i, event: e };
    }
  }
  return undefined;
}

/**
 * Fold full history ignoring compaction windows (for summarizer input).
 * @param options.indexOffset Absolute log index of `events[0]` when folding a
 *   post-compaction slice — `image/offload` targets use durable-log seq.
 * @param options.markSource Full session log for folding offload marks
 *   (defaults to `events`).
 */
export function deriveMessagesUnwindowed(
  events: readonly SessionEvent[],
  options?: {
    readonly indexOffset?: number;
    readonly markSource?: readonly SessionEvent[];
  },
): ChatMessage[] {
  return foldChat(
    events,
    options?.markSource ?? events,
    options?.indexOffset ?? 0,
  );
}

function foldChat(
  events: readonly SessionEvent[],
  markSource: readonly SessionEvent[],
  indexOffset: number,
): ChatMessage[] {
  const offloadMarks = foldImageOffloadMarks(markSource);
  const messages: ChatMessage[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const absSeq = i + indexOffset;
    switch (ev.type) {
      case "user/message":
        messages.push({
          role: "user",
          content: projectOffloadedImages(
            ev.content,
            offloadMarks.get(absSeq),
          ),
        });
        break;
      case "safety/notice":
        messages.push({ role: "user", content: ev.content });
        break;
      case "assistant/message": {
        // DSH deriveEventMessage: skip usage-only / content-less assistants
        // (e.g. max-tokens after keep/drop with no text left).
        const hasTools = Boolean(ev.toolCalls?.length);
        const hasReasoning = Boolean(ev.reasoning?.trim());
        const hasText = Boolean(ev.content.trim());
        if (!hasTools && !hasReasoning && !hasText) break;
        messages.push({
          role: "assistant",
          content: ev.content,
          ...(ev.toolCalls ? { toolCalls: ev.toolCalls } : {}),
          // DSH serializeAssistant (dsh-v0.1.0-rc.8): every reasoning-carrying
          // turn keeps CoT for gateway re-encode; omit only when empty.
          ...(ev.reasoning?.trim() ? { reasoning: ev.reasoning } : {}),
        });
        break;
      }
      case "tool/result": {
        const msg = {
          role: "tool" as const,
          content: projectOffloadedImages(
            ev.result.content,
            offloadMarks.get(absSeq),
          ),
          toolCallId: ev.result.toolCallId,
          name: ev.result.name,
          ...(ev.result.isError ? { isError: true as const } : {}),
        };
        // Latest surface wins (prune appends a replacement with the same callId).
        const existing = messages.findIndex(
          (m) => m.role === "tool" && m.toolCallId === ev.result.toolCallId,
        );
        if (existing >= 0) {
          messages[existing] = msg;
        } else {
          messages.push(msg);
        }
        break;
      }
      default:
        break;
    }
  }
  return messages;
}

export interface CompactionOptions {
  /** Soft ceiling for request tokens; proactive compact when exceeded. */
  readonly maxRequestTokens?: number;
  readonly keepTokens?: number;
  readonly bufferTokens?: number;
  /** Default true when options object is provided. */
  readonly auto?: boolean;
  /**
   * Soft-budget + overflow strategy family (DSH prune→summary posture, selectable):
   * - `prune-summary` (default): prune oversized tools, then LLM summary
   * - `prune-only`: model-free prune only; still fail-closed if over budget / overflow
   * - `summary-only`: skip prune pass; LLM summary only
   * - `off`: disable soft-budget auto path and provider-overflow recovery
   *   (manual `/compact` still works)
   */
  readonly strategy?: CompactionStrategy;
}

/** Soft-budget compaction strategy ids (Face `agent-loop.compactionStrategy`). */
export type CompactionStrategy =
  | "prune-summary"
  | "prune-only"
  | "summary-only"
  | "off";

export const COMPACTION_STRATEGIES: readonly CompactionStrategy[] = [
  "prune-summary",
  "prune-only",
  "summary-only",
  "off",
] as const;

export function parseCompactionStrategy(
  raw: unknown,
): CompactionStrategy | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim() as CompactionStrategy;
  return (COMPACTION_STRATEGIES as readonly string[]).includes(v)
    ? v
    : undefined;
}

/** Resolve strategy with default `prune-summary` when auto soft-budget is on. */
export function resolveCompactionStrategy(
  options: CompactionOptions | undefined,
): CompactionStrategy {
  if (!options || options.auto === false) return "off";
  return options.strategy ?? "prune-summary";
}


export function prepareCompactionPayload(
  events: readonly SessionEvent[],
  keepTokens: number,
):
  | {
      readonly prompt: string;
      readonly recent: string;
    }
  | undefined {
  const full = deriveMessagesUnwindowed(events);
  const selected = selectHeadRecent(full, keepTokens);
  const previous = findLatestCompaction(events)?.event;

  if (!selected || (selected.head.length === 0 && previous === undefined)) {
    return undefined;
  }

  const prompt = buildCompactionPrompt({
    ...(previous ? { previousSummary: previous.summary } : {}),
    head: [previous?.recent, selected.head].filter(Boolean).join("\n\n"),
  });

  return { prompt, recent: selected.recent };
}
