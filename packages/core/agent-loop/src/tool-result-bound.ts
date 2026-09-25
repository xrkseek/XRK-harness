/**
 * Bound oversized tool results before they enter the session log.
 * Byte ceiling is {@link TOOL_RESULT_MAX_INLINE_BYTES} (same number as
 * pipeline `boundToolOutput`). Face `agent-loop.toolResultMaxInlineBytes`
 * may raise/lower (`0` disables spill). `toolResultMaxInlineTokens` wins
 * over the byte ceiling when set (DSH `maxInlineBytes → maxInlineTokens`).
 *
 * Policy + storage live in `@xrkseek/spill` (separate seams). This module is
 * the agent-loop adapter: MessageContent ↔ plain text ↔ applySpillPolicy.
 *
 * Prefer {@link boundToolResultContent}'s `savedPath` (from
 * `RunToolOutcome.outputPaths`) over parsing the inline marker — a clipped
 * marker must not trigger a second write of the truncated preview.
 */
import { DEFAULT_TOOL_OUTPUT_MAX_BYTES } from "@xrkseek/core-tools";
import {
  applySpillPolicy,
  defaultLocalSpillStore,
  parseSpillLocator,
  type SpillStore,
} from "@xrkseek/spill";
import type { MessageContent } from "@xrkseek/protocol";

/** Shared with pipeline `DEFAULT_TOOL_OUTPUT_MAX_BYTES` (UTF-8 bytes). */
export const TOOL_RESULT_MAX_INLINE_BYTES = DEFAULT_TOOL_OUTPUT_MAX_BYTES;

/** Re-export for callers that still import from agent-loop. */
export { parseSpillLocator as alreadySavedPath } from "@xrkseek/spill";

function plainText(content: MessageContent): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== "text") return undefined;
    parts.push(block.text);
  }
  return parts.join("\n");
}

/**
 * Spill plain-text tool output over `maxInlineBytes` (default
 * {@link TOOL_RESULT_MAX_INLINE_BYTES}) or `maxInlineTokens` (wins).
 * `0` disables spill. Mixed content and read tools pass through unchanged.
 */
export function boundToolResultContent(input: {
  readonly sessionId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly content: MessageContent;
  /** UTF-8 inline ceiling; omit → 64_000; `0` → no spill. */
  readonly maxInlineBytes?: number;
  /**
   * Token inline ceiling (DSH `maxInlineTokens` semantics). When set it
   * wins over `maxInlineBytes`.
   */
  readonly maxInlineTokens?: number;
  /**
   * Authoritative full-body path from pipeline `outputPaths` (preferred over
   * parsing the inline marker).
   */
  readonly savedPath?: string;
  /** Override store (tests). Default {@link defaultLocalSpillStore}. */
  readonly store?: SpillStore;
}): { readonly content: MessageContent; readonly spilled: boolean } {
  const plain = plainText(input.content);
  if (plain === undefined) {
    return { content: input.content, spilled: false };
  }
  const out = applySpillPolicy({
    sessionId: input.sessionId,
    callId: input.callId,
    toolName: input.toolName,
    plainText: plain,
    ...(input.maxInlineBytes !== undefined
      ? { maxInlineBytes: input.maxInlineBytes }
      : {}),
    ...(input.maxInlineTokens !== undefined
      ? { maxInlineTokens: input.maxInlineTokens }
      : {}),
    ...(input.savedPath !== undefined ? { savedPath: input.savedPath } : {}),
    store: input.store ?? defaultLocalSpillStore(),
  });
  return { content: out.content, spilled: out.spilled };
}

/** Parse spill path from notice text (Status / timeline). */
export { parseSpillLocator };
