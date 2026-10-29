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
    return {
      lastEventTs: null,
      eventCount: 0,
      hasTurnStart: false,
      hasCommandRun: false,
    };
  }
  // Match durable hint columns: `last_ts = MAX(ts)` (not “last row’s ts”).
  // Title / end-seed often use `Date.now()` while replayed prefix keeps small
  // synthetic clocks — last-row would disagree with the cold DB path.
  let lastEventTs = events[0]!.ts;
  let hasTurnStart = false;
  let hasCommandRun = false;
  for (const event of events) {
    if (event.ts > lastEventTs) lastEventTs = event.ts;
    if (event.type === "turn/start") hasTurnStart = true;
    else if (event.type === "command/run") hasCommandRun = true;
  }
  return {
    lastEventTs,
    eventCount: events.length,
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
