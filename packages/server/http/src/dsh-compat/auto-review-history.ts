/**
 * DSH-aligned auto-review history filter: PROJECT_INSTRUCTIONS + FILTERED_HISTORY
 * with fixed source roles. Excludes system, assistant text/reasoning, and tool
 * results; keeps human/parent/constraint/checkpoint/fact + prior tool calls.
 */
import {
  asContentBlocks,
  flattenText,
  isHumanUserMessageSource,
  type MessageContent,
  type SessionEvent,
  type UserMessageSource,
} from "@xrkseek/protocol";

/** Reviewer-facing source roles (DSH REVIEW_POLICY vocabulary). */
export type AutoReviewSourceRole =
  | "human-instruction"
  | "direct-parent-instruction"
  | "constraint"
  | "checkpoint"
  | "fact";

export interface AutoReviewHistoryUserMessage {
  readonly kind: "user-message";
  readonly role: AutoReviewSourceRole;
  readonly sourceKind: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

export interface AutoReviewHistoryToolCall {
  readonly kind: "tool-call";
  readonly role: "fact";
  readonly mode: "native";
  readonly name: string;
  readonly arguments: string;
}

export type AutoReviewHistoryEntry =
  | AutoReviewHistoryUserMessage
  | AutoReviewHistoryToolCall;

export interface AutoReviewFilteredHistory {
  readonly projectInstructions: readonly AutoReviewHistoryUserMessage[];
  readonly history: readonly AutoReviewHistoryEntry[];
}

export interface FilterAutoReviewSessionHistoryOptions {
  /** Drop the pending call from history facts (current tool being reviewed). */
  readonly excludeToolCallId?: string;
  /** Cap retained history entries (most recent). Default 48. */
  readonly maxHistoryEntries?: number;
  /**
   * Seq of the in-process child's creation prompt → direct-parent-instruction.
   * When omitted, no user message gets that role.
   */
  readonly directParentPromptSeq?: number;
}

function sourceKindOf(source: UserMessageSource | undefined): string {
  if (!source) return "user";
  return source.kind;
}

function contentBlocksForReview(
  content: MessageContent,
  roleForText: AutoReviewSourceRole,
): AutoReviewHistoryUserMessage[] {
  if (typeof content === "string") {
    const text = content.trim();
    if (!text) return [];
    return [
      {
        kind: "user-message",
        role: roleForText,
        sourceKind: "user",
        content: [{ type: "text", text }],
      },
    ];
  }
  const out: AutoReviewHistoryUserMessage[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type === "text") {
      const text = block.text.trim();
      if (!text) continue;
      out.push({
        kind: "user-message",
        role: roleForText,
        sourceKind: "user",
        content: [{ type: "text", text }],
      });
      continue;
    }
    // Images / files are facts only (DSH non-text → fact).
    out.push({
      kind: "user-message",
      role: "fact",
      sourceKind: "user",
      content: [
        {
          type: block.type,
          ...(block.type === "image"
            ? { text: `image:${block.attachment.attachmentId}` }
            : { text: `file:${block.attachment.attachmentId}` }),
        },
      ],
    });
  }
  return out;
}

function textRoleForUserMessage(
  source: UserMessageSource | undefined,
  seq: number,
  options: FilterAutoReviewSessionHistoryOptions,
): AutoReviewSourceRole {
  if (options.directParentPromptSeq === seq) {
    return "direct-parent-instruction";
  }
  if (isHumanUserMessageSource(source)) {
    return "human-instruction";
  }
  if (source?.kind === "agent-instructions") {
    return "constraint";
  }
  if (source?.kind === "context-fragment" && source.fragmentKind === "recap") {
    return "checkpoint";
  }
  // skill-catalog / session-reference / plugin / auto-continue / other → fact
  return "fact";
}

/**
 * Durable-log index for parent-prompt matching. Prefer an explicit `seq` when
 * fixtures / wire carry one; otherwise use the 0-based array index
 * (same convention as {@link import("@xrkseek/protocol").ImageOffloadTarget}).
 */
function durableSeq(event: SessionEvent, index: number): number {
  const raw = (event as { readonly seq?: unknown }).seq;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : index;
}

/**
 * Fold session events into reviewer PROJECT_INSTRUCTIONS + FILTERED_HISTORY.
 *
 * Kept: human/parent/constraint/checkpoint/fact user messages; prior tool/call
 * as fact. Dropped: assistant text & reasoning, tool/result, request/header
 * system, admits, titles, and other non-instructional log noise.
 */
export function filterAutoReviewSessionHistory(
  events: readonly SessionEvent[],
  options: FilterAutoReviewSessionHistoryOptions = {},
): AutoReviewFilteredHistory {
  const projectInstructions: AutoReviewHistoryUserMessage[] = [];
  const history: AutoReviewHistoryEntry[] = [];
  const excludeId = options.excludeToolCallId?.trim();
  const maxHistory = Math.max(1, options.maxHistoryEntries ?? 48);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type === "user/message") {
      const source = event.source;
      // Tool-echoed user rows are not instructions.
      if (source?.kind === "plugin" && source.form === "tool") continue;

      if (source?.kind === "agent-instructions") {
        const rows = contentBlocksForReview(event.content, "constraint").map(
          (row) => ({
            ...row,
            sourceKind: "agent-instructions",
            role: "constraint" as const,
          }),
        );
        for (const row of rows) {
          if (row.content.length > 0) projectInstructions.push(row);
        }
        continue;
      }

      const role = textRoleForUserMessage(
        source,
        durableSeq(event, index),
        options,
      );
      const rows = contentBlocksForReview(event.content, role).map((row) => ({
        ...row,
        sourceKind: sourceKindOf(source),
        // Non-text already forced to fact inside contentBlocksForReview.
        role: row.role === "fact" ? ("fact" as const) : role,
      }));
      history.push(...rows);
      continue;
    }

    if (event.type === "context/compaction") {
      const summary = event.summary.trim();
      if (!summary) continue;
      history.push({
        kind: "user-message",
        role: "checkpoint",
        sourceKind: "compact-checkpoint",
        content: [{ type: "text", text: summary }],
      });
      continue;
    }

    if (event.type === "tool/call") {
      if (excludeId && event.call.id === excludeId) continue;
      let argumentsText: string;
      try {
        argumentsText = JSON.stringify(event.call.arguments ?? {});
      } catch {
        argumentsText = String(event.call.arguments ?? "");
      }
      history.push({
        kind: "tool-call",
        role: "fact",
        mode: "native",
        name: event.call.name,
        arguments: argumentsText,
      });
      continue;
    }

    // Explicitly skipped (DSH exclusions):
    // assistant/message · assistant/chunk (text/reasoning)
    // tool/result · request/header (system) · prompt/* · titles · …
  }

  const trimmedHistory =
    history.length <= maxHistory
      ? history
      : history.slice(history.length - maxHistory);

  return {
    projectInstructions,
    history: trimmedHistory,
  };
}

/** Flatten one history entry for tests / diagnostics. */
export function autoReviewHistoryEntryText(
  entry: AutoReviewHistoryEntry,
): string {
  if (entry.kind === "tool-call") {
    return `${entry.name} ${entry.arguments}`;
  }
  return entry.content.map((c) => c.text ?? "").join("");
}

/** Convenience: flatten MessageContent the same way Host/Face does. */
export function autoReviewFlattenContent(content: MessageContent): string {
  return flattenText(content);
}
