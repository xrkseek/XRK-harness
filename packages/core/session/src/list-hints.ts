/**
 * Sidebar / session-list metadata folded from a Session log.
 */
import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionListHints, SessionStore } from "./store.js";
import { readSessionEvents } from "./seq.js";

/** Fold list metadata from an in-memory event array. */
export function computeListHints(
  events: readonly SessionEvent[],
): SessionListHints {
  if (events.length === 0) {
    return { lastEventTs: null, hasTurnStart: false, hasCommandRun: false };
  }
  let hasTurnStart = false;
  let hasCommandRun = false;
  for (const event of events) {
    if (event.type === "turn/start") hasTurnStart = true;
    else if (event.type === "command/run") hasCommandRun = true;
    if (hasTurnStart && hasCommandRun) break;
  }
  return {
    lastEventTs: events[events.length - 1]?.ts ?? null,
    hasTurnStart,
    hasCommandRun,
  };
}

/** Sidebar / Hero blank bit: no turn and no slash-command lifecycle yet. */
export function sessionHintsBlank(hints: SessionListHints): boolean {
  return !hints.hasTurnStart && !hints.hasCommandRun;
}

/**
 * Store-facing list hints. Prefers `store.listHints` when implemented;
 * otherwise folds from {@link readSessionEvents}.
 */
export function sessionListHints(
  store: Pick<SessionStore, "readEvents"> & Pick<SessionStore, "listHints">,
  sessionId: string,
): SessionListHints {
  if (typeof store.listHints === "function") {
    return store.listHints(sessionId);
  }
  return computeListHints(readSessionEvents(store, sessionId));
}
