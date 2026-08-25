/**
 * Face tool-view: apiproxy `viewFor` — lookup only.
 * Cards come from each tool's `presentCall` / `presentResult`.
 */

import type { SessionEvent } from "@xrkseek/protocol";
import {
  presentToolEventView,
  type PresentToolLookup,
  type ToolCallPairing,
  type ToolEventView,
} from "@xrkseek/core-tools";

export type {
  DiffCallView,
  DiffResultView,
  GenericCallView,
  GenericResultView,
  PresentToolLookup,
  ReadResultView,
  SearchMatchesResultView,
  SearchPathsResultView,
  TerminalCallView,
  TerminalResultView,
  ToolCallPairing,
  ToolCallView,
  ToolEventView,
  ToolResultView,
  WebFetchResultView,
  WebSearchResultView,
} from "@xrkseek/core-tools";

export class FaceToolArgMaps {
  private readonly sessions = new Map<string, Map<string, ToolCallPairing>>();

  remember(sessionId: string, event: SessionEvent): void {
    if (event.type !== "tool/call") return;
    this.forSession(sessionId).set(event.call.id, {
      name: event.call.name,
      args: event.call.arguments,
    });
  }

  forSession(sessionId: string): Map<string, ToolCallPairing> {
    let map = this.sessions.get(sessionId);
    if (!map) {
      map = new Map();
      this.sessions.set(sessionId, map);
    }
    return map;
  }
}

export function collectToolCallArgs(
  events: readonly SessionEvent[],
): Map<string, ToolCallPairing> {
  const map = new Map<string, ToolCallPairing>();
  for (const event of events) {
    if (event.type === "tool/call") {
      map.set(event.call.id, {
        name: event.call.name,
        args: event.call.arguments,
      });
    }
  }
  return map;
}

/** Collect tool args only for calls referenced by a history page (bounded scan). */
export function collectToolCallArgsForPage(
  events: readonly SessionEvent[],
  pageEvents: readonly SessionEvent[],
  seqByEvent: ReadonlyMap<SessionEvent, number>,
): Map<string, ToolCallPairing> {
  const needed = new Set<string>();
  for (const event of pageEvents) {
    if (event.type === "tool/result") needed.add(event.result.toolCallId);
  }
  if (needed.size === 0) return new Map();

  const map = new Map<string, ToolCallPairing>();
  let maxSeq = 0;
  for (const event of pageEvents) {
    const seq = seqByEvent.get(event) ?? 0;
    if (seq > maxSeq) maxSeq = seq;
  }
  for (let i = events.length - 1; i >= 0 && needed.size > 0; i--) {
    const event = events[i]!;
    const seq = i + 1;
    if (seq > maxSeq) continue;
    if (event.type !== "tool/call" || !needed.has(event.call.id)) continue;
    map.set(event.call.id, {
      name: event.call.name,
      args: event.call.arguments,
    });
    needed.delete(event.call.id);
  }
  return map;
}

export function faceToolLookup(
  getTool: PresentToolLookup["getTool"],
  argsByCallId?: ReadonlyMap<string, ToolCallPairing>,
): PresentToolLookup {
  return {
    getTool,
    ...(argsByCallId
      ? { argsFor: (callId: string) => argsByCallId.get(callId) }
      : {}),
  };
}

/** Face `viewFor` — missing lookup / pairing / presenter → no view. */
export function presentToolView(
  event: SessionEvent,
  lookup?: PresentToolLookup,
): ToolEventView | undefined {
  if (!lookup) return undefined;
  return presentToolEventView(event, lookup);
}
