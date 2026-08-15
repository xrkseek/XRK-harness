/**
 * Host-owned tool event views — non-persisted, recomputed on mux/history.
 * Durable log stays pure XRK SessionEvent (ADR / lc20).
 */

import type { SessionEvent } from "@xrkseek/protocol";

export type ToolEventView =
  | {
      readonly kind: "tool-call";
      readonly callId: string;
      readonly name: string;
      readonly argsPreview: string;
    }
  | {
      readonly kind: "tool-result";
      readonly callId: string;
      readonly name: string;
      readonly ok: boolean;
      readonly preview: string;
    };

const PREVIEW_MAX = 240;

function previewText(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_MAX) return t;
  return `${t.slice(0, PREVIEW_MAX - 1)}…`;
}

export function presentToolView(
  event: SessionEvent,
): ToolEventView | undefined {
  if (event.type === "tool/call") {
    let argsPreview: string;
    try {
      argsPreview = previewText(JSON.stringify(event.call.arguments ?? {}));
    } catch {
      argsPreview = "[unserializable]";
    }
    return {
      kind: "tool-call",
      callId: event.call.id,
      name: event.call.name,
      argsPreview,
    };
  }
  if (event.type === "tool/result") {
    return {
      kind: "tool-result",
      callId: event.result.toolCallId,
      name: event.result.name,
      ok: !event.result.isError,
      preview: previewText(event.result.content),
    };
  }
  return undefined;
}
