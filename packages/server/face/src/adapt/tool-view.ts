/**
 * Face tool-view: DSH apiproxy `viewFor` — lookup only.
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

/** DSH `viewFor` — missing lookup / pairing / presenter → no view. */
export function presentToolView(
  event: SessionEvent,
  lookup?: PresentToolLookup,
): ToolEventView | undefined {
  if (!lookup) return undefined;
  return presentToolEventView(event, lookup);
}
