/**
 * DSH message-boundary history pagination over XRK protocol events.
 *
 * Counts `user/message` and `assistant/message` (append-origin transcript
 * messages), not raw log rows — so one streamed assistant turn with hundreds of
 * `assistant/chunk` events still counts as one page unit.
 */

import type { SessionEvent } from "@xrkseek/protocol";

/** DSH default when callers omit maxMessages (keep equal to client `PAGE_MESSAGES`). */
export const DEFAULT_HISTORY_MAX_MESSAGES = 50;

/**
 * Soft UTF-16 char budget for one history page before Face wire (tool dumps
 * can make a 50-message tail tens of MiB). Oversized pages shrink from the
 * older side so the client still gets the newest transcript first.
 */
export const DEFAULT_HISTORY_MAX_WIRE_CHARS = 1_500_000;

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
    if (event.type === "turn/end") break;
    start = i;
    if (event.type === "turn/start") break;
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
 * Inclusive index of the owning `turn/start` for the event at `fromIndex`.
 * A message-count cut can land on a later assistant of the same Host turn;
 * the rail and installWindow need that turn's opener in the page.
 */
export function owningTurnStartIndex(
  events: readonly SessionEvent[],
  fromIndex: number,
): number {
  const origin = events[fromIndex];
  if (origin === undefined) return fromIndex;
  const turnId = (origin as { turnId?: string }).turnId;
  if (typeof turnId !== "string" || turnId.length === 0) return fromIndex;
  for (let i = fromIndex; i >= 0; i--) {
    const event = events[i];
    if (event === undefined) break;
    if (event.type === "turn/start" && event.turnId === turnId) return i;
    if (event.type === "turn/start") break;
  }
  return fromIndex;
}

/**
 * Slice one backwards history page from the session log.
 * @returns page events and whether older pages exist.
 */
export function paginateSessionHistory(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): {
  readonly events: SessionEvent[];
  readonly hasMore: boolean;
  /** Absolute 0-based index of `events[0]` in the full log (0 when empty). */
  readonly startIndex: number;
} {
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
    return { events: [], hasMore: false, startIndex: 0 };
  }

  let count = 0;
  let cutIndex = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i];
    if (event === undefined || !MESSAGE_TYPES.has(event.type)) continue;
    count++;
    const groupStart = messageGroupStartIndex(window, i);
    if (count >= maxMessages) {
      cutIndex = owningTurnStartIndex(window, groupStart);
      break;
    }
  }

  return {
    events: window.slice(cutIndex),
    hasMore: cutIndex > 0,
    startIndex: cutIndex,
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
): {
  readonly events: SessionEvent[];
  readonly hasMore: boolean;
  readonly startIndex: number;
} {
  const page = paginateSessionHistory(events, beforeSeq, maxMessages);
  return {
    events: dropSupersededStreamDeltas(page.events),
    hasMore: page.hasMore,
    startIndex: page.startIndex,
  };
}

export function dropSupersededStreamDeltas(
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

/** Envelope overhead per event (type · ids · ts) — not a wire JSON clone. */
const EVENT_ENVELOPE_CHARS = 64;

/** Sum string / content weight without cloning the page as JSON. */
function estimateContentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content === undefined || content === null) return 0;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      if (
        block !== null
        && typeof block === "object"
        && "text" in block
        && typeof (block as { text: unknown }).text === "string"
      ) {
        n += (block as { text: string }).text.length;
      } else {
        try {
          n += JSON.stringify(block).length;
        } catch {
          n += 64;
        }
      }
    }
    return n;
  }
  try {
    return JSON.stringify(content).length;
  } catch {
    return 64;
  }
}

/**
 * Per-event size proxy for wire budget (string weights + small envelope).
 * Avoids `JSON.stringify(page)` on every trim cut — that was O(page × cuts)
 * and could cost more than shipping a slightly large page.
 */
export function estimateHistoryEventChars(event: SessionEvent): number {
  let n = EVENT_ENVELOPE_CHARS;
  const rec = event as SessionEvent & {
    readonly content?: unknown;
    readonly text?: string;
    readonly reasoning?: string;
  };
  if (rec.content !== undefined) n += estimateContentChars(rec.content);
  if (typeof rec.text === "string") n += rec.text.length;
  if (typeof rec.reasoning === "string") n += rec.reasoning.length;
  if (event.type === "tool/call") {
    n += estimateContentChars(event.call.arguments);
    n += event.call.name.length;
  } else if (event.type === "tool/result") {
    n += estimateContentChars(event.result.content);
    n += event.result.name.length;
  }
  return n;
}

/** Sum of {@link estimateHistoryEventChars} over a page. */
export function estimateHistoryPageChars(
  events: readonly SessionEvent[],
): number {
  let total = 0;
  for (const event of events) total += estimateHistoryEventChars(event);
  return total;
}

function firstMessageIndex(
  events: readonly SessionEvent[],
  from = 0,
): number {
  for (let i = from; i < events.length; i++) {
    const event = events[i];
    if (event !== undefined && MESSAGE_TYPES.has(event.type)) return i;
  }
  return -1;
}

/**
 * Drop oldest message groups until the page fits `maxChars` (or a single
 * oversized group remains — cannot shrink further without breaking seq continuity).
 *
 * Sizes are computed once; each cut subtracts the dropped prefix (O(n + cuts)).
 */
export function trimHistoryPageToWireBudget(
  events: readonly SessionEvent[],
  startIndex: number,
  hasMore: boolean,
  maxChars: number = DEFAULT_HISTORY_MAX_WIRE_CHARS,
): {
  readonly events: SessionEvent[];
  readonly hasMore: boolean;
  readonly startIndex: number;
} {
  if (events.length === 0 || !(maxChars > 0)) {
    return { events: [...events], hasMore, startIndex };
  }
  const sizes = events.map(estimateHistoryEventChars);
  let total = 0;
  for (const size of sizes) total += size;
  if (total <= maxChars) {
    return { events: [...events], hasMore, startIndex };
  }

  let lo = 0;
  let more = hasMore;
  while (lo < events.length - 1 && total > maxChars) {
    const firstMsg = firstMessageIndex(events, lo);
    if (firstMsg < 0) break;
    // Work on the remaining suffix as a virtual page (absolute indices).
    const page = events.slice(lo);
    const localFirst = firstMsg - lo;
    let cutAbs = -1;
    let probe = localFirst + 1;
    while (probe < page.length) {
      const nextMsg = firstMessageIndex(page, probe);
      if (nextMsg < 0) break;
      const nextCut = owningTurnStartIndex(
        page,
        messageGroupStartIndex(page, nextMsg),
      );
      if (nextCut > 0 && nextCut < page.length) {
        cutAbs = lo + nextCut;
        break;
      }
      probe = nextMsg + 1;
    }
    if (cutAbs <= lo) break;
    for (let i = lo; i < cutAbs; i++) total -= sizes[i]!;
    lo = cutAbs;
    more = true;
  }
  return {
    events: events.slice(lo),
    hasMore: more,
    startIndex: startIndex + lo,
  };
}
