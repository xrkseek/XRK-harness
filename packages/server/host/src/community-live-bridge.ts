/**
 * Face → community-root live meter (whale-girl).
 *
 * DSH whale Host tracks one `currentSession` via Cordis events and calls
 * `tokenMeter.measure(session)`. XRK has no that fiber — we must not mimic
 * "scan store.list() + fold every projection" (hundreds of sessions / huge
 * sqlite). Hot path:
 *   1. cost-meter ledger once (balance + today CNY)
 *   2. drain-active sessions only for context/workstate (+ last busy memory)
 */
import {
  costMeterDisplayExchangeRate,
  costMeterGetState,
  costMeterGetTopSessions,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  WHALE_DEFAULT_CONTEXT_LIMIT,
  type CommunityLiveMeter,
} from "@xrkseek/server-http";

const CACHE_MS = 5_000;

let cache:
  | { readonly at: number; readonly value: CommunityLiveMeter }
  | undefined;
/** Last session that was busy or had measurable context — DSH currentSession. */
let lastSessionId: string | undefined;
let workStateSince = Date.now();

function readContextFromSnapshot(face: FaceRuntime, sessionId: string): {
  tokens: number;
  limit: number;
} {
  const snap = face.projections.snapshot(sessionId);
  const tl = snap.values.contextTimeline as
    | {
        current?: { total?: number };
        contextWindow?: number;
      }
    | undefined;
  const cp = snap.values.contextPressure as
    | {
        projectedTokens?: number;
        pressureTokens?: number;
        contextWindow?: number;
      }
    | undefined;
  const fromTimeline =
    typeof tl?.current?.total === "number" ? tl.current.total : 0;
  const fromPressure =
    typeof cp?.projectedTokens === "number"
      ? cp.projectedTokens
      : typeof cp?.pressureTokens === "number"
        ? cp.pressureTokens
        : 0;
  const tokens = Math.max(fromTimeline, fromPressure);
  const window =
    (typeof tl?.contextWindow === "number" && tl.contextWindow > 0
      ? tl.contextWindow
      : undefined) ??
    (typeof cp?.contextWindow === "number" && cp.contextWindow > 0
      ? cp.contextWindow
      : undefined);
  return {
    tokens,
    limit: window ?? WHALE_DEFAULT_CONTEXT_LIMIT,
  };
}

export function createCommunityLiveMeterFromFace(
  face: FaceRuntime,
): () => CommunityLiveMeter {
  return () => {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS) return cache.value;

    // One ledger read — same source wallet/cost-meter UI already uses.
    const meterState = costMeterGetState();
    const rate = costMeterDisplayExchangeRate();
    const bal = meterState.balance as {
      status?: string;
      currency?: string;
      totalBalance?: number;
    };
    const balance =
      bal.status === "ok" &&
      typeof bal.totalBalance === "number" &&
      Number.isFinite(bal.totalBalance)
        ? bal.totalBalance
        : null;
    const currency =
      typeof bal.currency === "string" && bal.currency.trim()
        ? bal.currency
        : "CNY";
    const todayUsd =
      typeof meterState.today?.cost === "number" ? meterState.today.cost : 0;
    const todayUsage = todayUsd * rate;

    const busyIds: string[] = [];
    for (const sessionId of face.store.list()) {
      try {
        if (face.drain.isActive(sessionId) && !face.isTurnUiIdle(sessionId)) {
          busyIds.push(sessionId);
        }
      } catch {
        /* skip */
      }
    }

    // Idle after restart: seed one id from cost-meter recent activity
    // (DSH lastKnownSession) — never walk the whole store for projections.
    if (!lastSessionId && busyIds.length === 0) {
      try {
        const top = costMeterGetTopSessions(1, "time").sessions[0];
        const id = typeof top?.id === "string" ? top.id.trim() : "";
        if (id) lastSessionId = id;
      } catch {
        /* optional */
      }
    }

    const focusIds =
      busyIds.length > 0
        ? busyIds
        : lastSessionId
          ? [lastSessionId]
          : [];

    let contextTokens = 0;
    let contextLimit = WHALE_DEFAULT_CONTEXT_LIMIT;
    let bestId: string | undefined;
    for (const sessionId of focusIds) {
      try {
        const { tokens, limit } = readContextFromSnapshot(face, sessionId);
        if (tokens >= contextTokens) {
          contextTokens = tokens;
          contextLimit = limit;
          bestId = sessionId;
        }
      } catch {
        /* cold/missing fold — skip */
      }
    }
    if (bestId) lastSessionId = bestId;
    else if (busyIds[0]) lastSessionId = busyIds[0];

    let subagentRunning = 0;
    for (const parentId of busyIds.slice(0, 4)) {
      try {
        const team = face.agentTeams.view(parentId);
        let running = 0;
        for (const node of team.nodes ?? []) {
          if (!node?.id || node.id === parentId) continue;
          try {
            if (face.drain.isActive(node.id)) running += 1;
          } catch {
            /* skip */
          }
        }
        if (running > subagentRunning) subagentRunning = running;
      } catch {
        /* optional */
      }
    }

    const anyBusy = busyIds.length > 0;
    if (anyBusy) workStateSince = now;

    const value: CommunityLiveMeter = {
      balance,
      currency,
      todayUsage,
      contextTokens,
      contextLimit,
      subagentRunning,
      workState: anyBusy ? "thinking" : "idle",
      workStateSince,
      lastTurnCost: null,
    };
    cache = { at: now, value };
    return value;
  };
}
