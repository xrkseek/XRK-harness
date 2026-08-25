import type { SessionEvent } from "@xrkseek/protocol";
import type { FaceSubagentLink } from "../subagent-registry.js";

function lastAssistantText(events: readonly SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/message") {
      const text = String(ev.content ?? "").trim();
      if (text) return text;
    }
  }
  return "";
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
  const preview = lastAssistantText(events);
  const follow =
    "Follow up with send_message, interrupt_agent when done, or list_agents.";
  if (!preview) return `${head} ${follow}`;
  const clipped =
    preview.length > maxPreviewChars
      ? `${preview.slice(0, maxPreviewChars)}\n…`
      : preview;
  return `${head}\n\n${clipped}\n\n${follow}`;
}
