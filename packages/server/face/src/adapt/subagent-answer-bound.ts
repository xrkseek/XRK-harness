/**
 * Shared child→parent answer sizing: keep short answers inline; spill long
 * ones under the same tool-outputs store the agent-loop uses.
 */
import {
  boundToolResultContent,
  parseSpillLocator,
} from "@xrkseek/core-agent-loop";

/**
 * Inline ceiling for one child's answer before it goes to a file (UTF-8
 * bytes). Well under the loop-level tool-result ceiling (64_000) so a spilled
 * answer never spills twice; CJK ≈ 3 bytes/char leaves ~4k chars inline.
 */
export const SUBAGENT_ANSWER_INLINE_BYTES = 12_000;

/** Imperative lead so the parent reads the file instead of re-asking. */
const SPILL_READ_HINT =
  "The child's full answer is on disk. Read it with read_file (or grep) " +
  "before you answer — do not re-ask the child to restate it in fewer words.";

/**
 * Long child answers become a file the parent can read: the tool result /
 * completion notice keeps a head/tail preview plus the path (same spill store
 * the loop uses). Short answers pass through untouched.
 */
export function boundChildAnswer(
  parentSessionId: string,
  childSessionId: string,
  text: string,
): string {
  if (!text || parseSpillLocator(text)) return text;
  const bound = boundToolResultContent({
    sessionId: parentSessionId,
    callId: `subagent-${childSessionId}`,
    toolName: "subagent",
    content: text,
    maxInlineBytes: SUBAGENT_ANSWER_INLINE_BYTES,
  });
  const body = typeof bound.content === "string" ? bound.content : text;
  return bound.spilled ? `${SPILL_READ_HINT}\n\n${body}` : body;
}
