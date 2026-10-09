/**
 * Append `request/header` when the active LLM route changes (DSH reconstructable requests).
 *
 * Extreme sessions: each tool step used to `readSessionEvents` + full-log fold
 * even when the auto path would no-op. Cache the last folded snapshot per
 * session so the hot path is O(1); cold miss still uses tail-fold.
 */
import {
  foldRequestHeader,
  requestHeaderEquals,
  requestHeaderRouteEquals,
  type RequestHeaderSnapshot,
  type SessionStore,
  readSessionEvents,
} from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import type {
  RequestHeaderReason,
  RequestHeaderToolSchema,
  SessionEvent,
} from "@xrkseek/protocol";

/** Last appended/folded header per session (Host process lifetime). */
const lastHeaderBySession = new Map<string, RequestHeaderSnapshot>();

/**
 * Drop cached header snapshot(s). Call on session delete and from tests.
 * Host restart clears the Map. Do not clear on resident eviction — the log
 * still owns the header and the next cold miss re-folds once.
 */
export function forgetRequestHeaderCache(sessionId?: string): void {
  if (sessionId === undefined) {
    lastHeaderBySession.clear();
    return;
  }
  lastHeaderBySession.delete(sessionId);
}

function resolveHeaderSnapshot(
  llm: LlmAdapter,
): RequestHeaderSnapshot | undefined {
  if (llm.ensureRoute) {
    return { config: llm.ensureRoute() };
  }
  const route = llm.peekRoute?.();
  if (!route) return undefined;
  return { config: route };
}

/** True when the log already has a closed turn (resume vs first-ever header). */
function logHasTurnEnd(events: readonly SessionEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === "turn/end") return true;
  }
  return false;
}

export function maybeAppendRequestHeader(input: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly llm: LlmAdapter;
  readonly now: () => number;
  readonly reason?: RequestHeaderReason;
  /** Assembled system prompt for this step (Face contextBreakdown). */
  readonly system?: string;
  /** Standing tool schemas for this step. */
  readonly tools?: readonly RequestHeaderToolSchema[];
}): void {
  const route = resolveHeaderSnapshot(input.llm);
  if (!route) return;
  const snap: RequestHeaderSnapshot = {
    config: route.config,
    ...(input.system?.trim() ? { system: input.system } : {}),
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
    ...(route.adapterDefaults ? { adapterDefaults: route.adapterDefaults } : {}),
  };

  let prev = lastHeaderBySession.get(input.sessionId);
  let coldEvents: readonly SessionEvent[] | undefined;
  if (prev === undefined) {
    coldEvents = readSessionEvents(input.store, input.sessionId);
    prev = foldRequestHeader(coldEvents);
    if (prev) lastHeaderBySession.set(input.sessionId, prev);
  }

  if (prev) {
    // Auto step path: assembled system often churns every tool loop (inject /
    // workspace noise) while route+tools stay fixed — that used to write a
    // ~100KB `request/header` per step and balloon sessions.db / resident RAM.
    // Explicit `reason` (overflow compact · resume callers) still compares the
    // full snapshot so a real system rewrite is logged.
    const same = input.reason === undefined
      ? requestHeaderRouteEquals(prev, snap)
      : requestHeaderEquals(prev, snap);
    if (same) return;
  }

  // coldEvents is set whenever prev was missing after the cache probe (fold
  // miss ⇒ first header of this Host view of the session).
  const reason: RequestHeaderReason =
    input.reason
    ?? (prev
      ? "change"
      : logHasTurnEnd(coldEvents ?? [])
        ? "resume"
        : "initial");
  input.store.append(input.sessionId, {
    type: "request/header",
    ts: input.now(),
    turnId: input.turnId,
    reason,
    header: snap,
  });
  lastHeaderBySession.set(input.sessionId, snap);
}
