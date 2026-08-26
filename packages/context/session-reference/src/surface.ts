/** Face SessionStore surface projection for cross-session references. */

import {
  flattenText,
  isHumanUserMessageSource,
  type ContextCompactionEvent,
  type SessionEvent,
} from "@xrkseek/protocol";
import type { ProjectedConversationItem } from "./retention.js";

/** One referenced session observed through Face `SessionStore.get`. */
export interface FaceSessionSurface {
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly events: readonly SessionEvent[];
}

export function buildFaceSessionSurface(
  sessionId: string,
  events: readonly SessionEvent[],
  cwd?: string,
): FaceSessionSurface {
  return {
    sessionId,
    cwd: cwd ?? null,
    events,
  };
}

/**
 * Project human user / assistant text from protocol events, including the latest
 * compaction summary as a checkpoint row when present.
 */
export function projectFaceSessionConversation(
  surface: FaceSessionSurface,
): ProjectedConversationItem[] {
  const compact = findLatestCompaction(surface.events);
  const after = compact
    ? surface.events.slice(compact.index + 1)
    : surface.events;
  const conversation: ProjectedConversationItem[] = [];
  if (compact) {
    const text = formatCompactionForModel(compact.event);
    if (text !== "") {
      conversation.push({
        role: "user",
        text,
        checkpoint: true,
        originalText: text,
        omittedBytes: 0,
      });
    }
  }
  for (const event of after) {
    if (event.type === "user/message") {
      if (!isHumanUserMessageSource(event.source)) continue;
      const text = flattenText(event.content);
      if (text === "") continue;
      conversation.push({
        role: "user",
        text,
        checkpoint: false,
        originalText: text,
        omittedBytes: 0,
      });
      continue;
    }
    if (event.type === "assistant/message") {
      const text = event.content.trim();
      if (text === "") continue;
      conversation.push({
        role: "assistant",
        text,
        checkpoint: false,
        originalText: text,
        omittedBytes: 0,
      });
    }
  }
  return conversation;
}

function findLatestCompaction(
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

function formatCompactionForModel(event: ContextCompactionEvent): string {
  const recent = event.recent.trim()
    ? `\n\n## Recent\n${event.recent}`
    : "";
  return `[context compacted · ${event.reason}]\n## Summary\n${event.summary}${recent}`;
}
