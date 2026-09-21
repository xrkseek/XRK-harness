import type { SessionEvent } from "@xrkseek/protocol";
import type { FaceSubagentLink } from "../subagent-registry.js";

/**
 * Child body text for parent-facing completion / tool results.
 *
 * Only `assistant/message.content` (or text `assistant/chunk`s). Never
 * `reasoning` / reasoning chunks — parent providers must not receive the
 * child's CoT in the next request (DSH settlement keeps text blocks only;
 * Codex: reasoning never enters the parent session).
 */
export function lastAssistantBodyText(
  events: readonly SessionEvent[],
): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/message") {
      const text = ev.content.trim();
      if (text) return text;
      // Empty body with reasoning-only (or tool-only) turn: keep searching;
      // never fall through to ev.reasoning.
      continue;
    }
  }

  // Incomplete turn: fold text chunks only (skip reasoning / usage / tool-call).
  let stepId: string | undefined;
  let folded = "";
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== "assistant/chunk") continue;
    if (stepId === undefined) stepId = ev.stepId;
    else if (ev.stepId !== stepId) break;
    const kind = ev.kind ?? "text";
    if (kind !== "text") continue;
    folded = ev.text + folded;
  }
  return folded.trim();
}

/**
 * Parent inbox notice when a background (continuable) child drain goes idle.
 * Mirrors job completion copy: short status + how to follow up.
 */
export function formatSubagentCompletionNotice(
  link: FaceSubagentLink,
  events: readonly SessionEvent[],
  maxPreviewChars = 2000,
): string {
  const head = `background subagent \`${link.childSessionId}\` (${link.label}) finished a turn.`;
  const preview = lastAssistantBodyText(events);
  const follow =
    "Follow up with send_message, interrupt_agent when done, or list_agents.";
  if (!preview) return `${head} ${follow}`;
  const clipped =
    preview.length > maxPreviewChars
      ? `${preview.slice(0, maxPreviewChars)}\n…`
      : preview;
  return `${head}\n\n${clipped}\n\n${follow}`;
}
