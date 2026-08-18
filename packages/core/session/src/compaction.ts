/**
 * Context compaction helpers — window swap, never delete the log.
 * LLM call lives in agent-loop (`runCompaction`); this module stays I/O-light.
 * @see docs/session-compaction.md
 */

import type {
  ChatMessage,
  CompactionReason,
  ContextCompactionEvent,
  SessionEvent,
} from "@xrkseek/protocol";
import { flattenText } from "@xrkseek/protocol";

export type { CompactionReason };

export const DEFAULT_COMPACTION_KEEP_TOKENS = 8_000;
export const DEFAULT_COMPACTION_BUFFER_TOKENS = 2_000;

/** Rough token estimate (chars/4) — good enough for M1 budgets. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function messagePlainText(m: ChatMessage): string {
  if (m.role === "user") return flattenText(m.content);
  return m.content ?? "";
}

export function estimateMessagesTokens(
  messages: readonly ChatMessage[],
): number {
  let n = 0;
  for (const m of messages) {
    n += estimateTokens(messagePlainText(m));
    if (m.role === "assistant" && m.toolCalls) {
      for (const c of m.toolCalls) {
        n += estimateTokens(c.name);
        n += estimateTokens(JSON.stringify(c.arguments ?? {}));
      }
    }
  }
  return n;
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
    const body =
      m.content.length > 2_000
        ? `${m.content.slice(0, 2_000)}\n[truncated]`
        : m.content;
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
): { readonly head: string; readonly recent: string } | undefined {
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
 */
export function deriveMessagesUnwindowed(
  events: readonly SessionEvent[],
): ChatMessage[] {
  return foldChat(events);
}

function foldChat(events: readonly SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case "user/message":
        messages.push({ role: "user", content: ev.content });
        break;
      case "safety/notice":
        messages.push({ role: "user", content: ev.content });
        break;
      case "assistant/message":
        messages.push({
          role: "assistant",
          content: ev.content,
          ...(ev.toolCalls ? { toolCalls: ev.toolCalls } : {}),
        });
        break;
      case "tool/result":
        messages.push({
          role: "tool",
          content: ev.result.content,
          toolCallId: ev.result.toolCallId,
          name: ev.result.name,
          ...(ev.result.isError ? { isError: true } : {}),
        });
        break;
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
