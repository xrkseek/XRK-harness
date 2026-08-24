/**
 * DSH message-boundary history pagination over XRK protocol events.
 *
 * Counts `user/message` and `assistant/message` (append-origin transcript
 * messages), not raw log rows — so one streamed assistant turn with hundreds of
 * `assistant/chunk` events still counts as one page unit.
 */

import type { SessionEvent } from "@xrkseek/protocol";

/** DSH default when callers omit maxMessages. */
export const DEFAULT_HISTORY_MAX_MESSAGES = 50;

const MESSAGE_TYPES = new Set<string>(["user/message", "assistant/message"]);

function eventSeq(index: number): number {
  return index + 1;
}

function sameTurnStep(
  left: SessionEvent,
  turnId: string,
  stepId: string,
): boolean {
  const rec = left as { turnId?: string; stepId?: string };
  return rec.turnId === turnId && rec.stepId === stepId;
}

/** Inclusive 0-based start index of one transcript message's supporting events. */
export function messageGroupStartIndex(
  events: readonly SessionEvent[],
  messageIndex: number,
): number {
  const msg = events[messageIndex];
  if (msg === undefined || !MESSAGE_TYPES.has(msg.type)) return messageIndex;

  let start = messageIndex;
  for (let i = messageIndex - 1; i >= 0; i--) {
    const event = events[i];
    if (event === undefined || MESSAGE_TYPES.has(event.type)) break;
    start = i;
  }

  if (msg.type === "user/message") {
    for (let i = start - 1; i >= 0; i--) {
      const event = events[i];
      if (event === undefined) break;
      if (event.type === "turn/start" && event.turnId === msg.turnId) {
        start = i;
        break;
      }
      if (event.type === "turn/end" || MESSAGE_TYPES.has(event.type)) break;
    }
    return start;
  }

  if (msg.type === "assistant/message") {
    const { turnId, stepId } = msg;
    for (let i = start - 1; i >= 0; i--) {
      const event = events[i];
      if (event === undefined) break;
      if (
        event.type === "step/start"
        && sameTurnStep(event, turnId, stepId)
      ) {
        start = i;
        break;
      }
      if (MESSAGE_TYPES.has(event.type) || event.type === "turn/end") break;
    }
  }
  return start;
}

/**
 * Slice one backwards history page from the session log.
 * @returns page events and whether older pages exist.
 */
export function paginateSessionHistory(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { readonly events: SessionEvent[]; readonly hasMore: boolean } {
  let windowEnd = events.length;
  if (beforeSeq !== undefined) {
    windowEnd = 0;
    for (let i = 0; i < events.length; i++) {
      if (eventSeq(i) < beforeSeq) windowEnd = i + 1;
      else break;
    }
  }
  const window = events.slice(0, windowEnd);
  if (window.length === 0) {
    return { events: [], hasMore: false };
  }

  let count = 0;
  let cutIndex = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i];
    if (event === undefined || !MESSAGE_TYPES.has(event.type)) continue;
    count++;
    const groupStart = messageGroupStartIndex(window, i);
    if (count >= maxMessages) {
      cutIndex = groupStart;
      break;
    }
  }

  return {
    events: window.slice(cutIndex),
    hasMore: cutIndex > 0,
  };
}

/**
 * One `session.history` replay page (DSH `historyPage` shape): message-boundary
 * pagination, then drop streaming deltas superseded by durable surface rows.
 *
 * SQLite reload expands packed `text-chunks` / `tool-call-chunks` back into
 * thousands of `assistant/chunk` events. Completed steps already expose
 * `assistant/message`; tool args live on `tool/call`. The web client replays
 * history through `installWindow` — shipping those deltas freezes the UI.
 */
export function paginateSessionHistoryForReplay(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number = DEFAULT_HISTORY_MAX_MESSAGES,
): { readonly events: SessionEvent[]; readonly hasMore: boolean } {
  const page = paginateSessionHistory(events, beforeSeq, maxMessages);
  return {
    events: dropSupersededStreamDeltas(page.events),
    hasMore: page.hasMore,
  };
}

function dropSupersededStreamDeltas(
  events: readonly SessionEvent[],
): SessionEvent[] {
  const finalizedSteps = new Set<string>();
  const finalizedToolCalls = new Set<string>();
  for (const event of events) {
    if (event.type === "assistant/message") {
      finalizedSteps.add(`${event.turnId}\0${event.stepId}`);
    } else if (event.type === "tool/call") {
      finalizedToolCalls.add(event.call.id);
    }
  }
  if (finalizedSteps.size === 0 && finalizedToolCalls.size === 0) {
    return [...events];
  }
  return events.filter((event) => {
    if (event.type !== "assistant/chunk") return true;
    if (
      event.kind === "tool-call"
      && event.toolCallId !== undefined
      && finalizedToolCalls.has(event.toolCallId)
    ) {
      return false;
    }
    return !finalizedSteps.has(`${event.turnId}\0${event.stepId}`);
  });
}
