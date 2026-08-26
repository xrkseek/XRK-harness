/** Current-surface projection and byte-bounded rendering (Cordis session-query path). */

import { isCompactCheckpointSource } from "@xrkseek/xrk-compaction";
import type { SessionSurfaceSnapshot } from "@xrkseek/xrk-session-query";
import { assertNever } from "@xrkseek/xrk-llm";
import {
  type ReferencedSessionData,
  type ReferenceRetentionStats,
  type ProjectedConversationItem,
  retainProjectedConversation,
} from "./retention.js";

export type { ReferencedSessionData, ReferenceRetentionStats } from "./retention.js";

/**
 * Fit one projected snapshot into an exact rendered JSON-object byte cap.
 * @param snapshot - current-surface source observation.
 * @param label - host-provided display label serialized with the source.
 * @param maxBytes - maximum UTF-8 bytes for the serialized data object.
 * @returns retained data and stats, or `undefined` when fixed data cannot fit.
 */
export function retainReferencedSession(
  snapshot: SessionSurfaceSnapshot,
  label: string,
  maxBytes: number,
): { data: ReferencedSessionData; stats: ReferenceRetentionStats } | undefined {
  const projected = projectSessionConversation(snapshot);
  return retainProjectedConversation(
    {
      sessionId: snapshot.session.id,
      label,
      cwd: snapshot.session.cwd ?? null,
      capturedThroughSeq: snapshot.capturedThroughSeq,
    },
    projected,
    maxBytes,
  );
}

/** Project current user/assistant conversation while excluding tools, reasoning, and injected context. */
function projectSessionConversation(
  snapshot: SessionSurfaceSnapshot,
): ProjectedConversationItem[] {
  const conversation: ProjectedConversationItem[] = [];
  for (const event of snapshot.events) {
    switch (event.type) {
      case "user/message": {
        const checkpoint = isCompactCheckpointSource(event.data.source);
        if (!checkpoint && event.data.source.kind !== "user") break;
        const text = textContent(event.data.content);
        if (text !== "") {
          conversation.push({
            role: "user",
            text,
            checkpoint,
            originalText: text,
            omittedBytes: 0,
          });
        }
        break;
      }
      case "assistant/message": {
        const text = textContent(event.data.message.content);
        if (text !== "") {
          conversation.push({
            role: "assistant",
            text,
            checkpoint: false,
            originalText: text,
            omittedBytes: 0,
          });
        }
        break;
      }
      case "tool/result":
        break;
      /* v8 ignore next 2 -- SurfaceEventType is closed and every variant is handled above. */
      default:
        assertNever(event, "session-reference surface event");
    }
  }
  return conversation;
}

function textContent(
  content: readonly { type: string; text?: string }[],
): string {
  return content
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join("\n");
}
