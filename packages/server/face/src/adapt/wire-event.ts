/**
 * XRK SessionEvent → Face mux/history wire row.
 * Highlight: Host computes optional `view`; client never folds domain.
 */

import type { SessionEvent } from "@xrkseek/protocol";
import { presentToolView, type ToolEventView } from "./tool-view.js";

/** Published isomorphism keys (XRK type → wire role). */
export const EVENT_ISOMORPHISM = {
  "user/message": "user",
  "assistant/chunk": "assistant.delta",
  "assistant/message": "assistant.message",
  "tool/call": "tool.call",
  "tool/result": "tool.result",
  "turn/start": "turn.start",
  "turn/end": "turn.end",
  "step/start": "step.start",
  "step/end": "step.end",
  "prompt/admitted": "inbox.admitted",
  "prompt/promoted": "inbox.promoted",
  "prompt/withdrawn": "inbox.withdrawn",
  "safety/notice": "safety",
  "context/compaction": "compaction",
  "session/title": "title",
  "approval/asked": "approval.asked",
  "approval/decided": "approval.decided",
} as const satisfies Record<SessionEvent["type"], string>;

export interface WireHistoryEntry {
  readonly event: SessionEvent;
  readonly seq: number;
  readonly view?: ToolEventView;
}

export function toWireHistoryEntry(
  event: SessionEvent,
  seq: number,
): WireHistoryEntry {
  const view = presentToolView(event);
  return {
    event,
    seq,
    ...(view ? { view } : {}),
  };
}

export function toMuxSessionEvent(
  sessionId: string,
  event: SessionEvent,
  seq: number,
): {
  readonly type: "session/event";
  readonly sessionId: string;
  readonly event: SessionEvent;
  readonly seq: number;
  readonly view?: ToolEventView;
} {
  const view = presentToolView(event);
  return {
    type: "session/event",
    sessionId,
    event,
    seq,
    ...(view ? { view } : {}),
  };
}
