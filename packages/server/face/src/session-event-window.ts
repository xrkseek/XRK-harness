/**
 * Bounded raw-log window around one Face seq (DSH `readEvent` / SessionEventWindow).
 * Face seq is 1-based (`eventSeq(i) === i + 1`); store indices are 0-based.
 */
import {
  readSessionEvents,
  SessionLogOffset,
  sessionEventCount,
  type SessionStore,
} from "@xrkseek/core-session";
import type { SessionEvent } from "@xrkseek/protocol";
import type { FaceRpcResult } from "./types.js";

/** Default / hard cap for `before` and `after` (DSH `SESSION_QUERY_READ_WINDOW_MAX`). */
export const SESSION_EVENT_WINDOW_MAX = 50;

export interface SessionEventWindowRow {
  /** Face wire seq (1-based). */
  readonly seq: number;
  readonly type: string;
  readonly ts: number;
}

export interface SessionEventWindowValue {
  readonly sessionId: string;
  /** Requested target Face seq. */
  readonly seq: number;
  /** First Face seq included in `events` (inclusive). */
  readonly startSeq: number;
  /** Last Face seq included in `events` (inclusive). */
  readonly endSeq: number;
  readonly events: readonly SessionEventWindowRow[];
}

export interface SessionEventWindowRequest {
  readonly sessionId: string;
  readonly seq: number;
  readonly before: number;
  readonly after: number;
}

function clampWindowSide(raw: unknown, fallback: number): number | undefined {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    return undefined;
  }
  return Math.min(raw, SESSION_EVENT_WINDOW_MAX);
}

export function parseEventWindowPayload(
  payload: unknown,
): FaceRpcResult<SessionEventWindowRequest> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId and seq required" },
    };
  }
  const body = payload as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (
    typeof body.seq !== "number" ||
    !Number.isSafeInteger(body.seq) ||
    body.seq < 1
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "seq must be a positive Face wire seq",
      },
    };
  }
  const before = clampWindowSide(body.before, 3);
  const after = clampWindowSide(body.after, 3);
  if (before === undefined || after === undefined) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `before/after must be integers in 0..${SESSION_EVENT_WINDOW_MAX}`,
      },
    };
  }
  return {
    ok: true,
    value: { sessionId, seq: body.seq, before, after },
  };
}

function toRow(event: SessionEvent, seq: number): SessionEventWindowRow {
  return { seq, type: event.type, ts: event.ts };
}

/**
 * Read `[seq-before, seq+after]` clamped to the log.
 * Missing target seq → `undefined` (caller maps to not-found).
 */
export function readSessionEventWindow(
  store: SessionStore,
  request: SessionEventWindowRequest,
): SessionEventWindowValue | undefined {
  if (!store.has(request.sessionId)) return undefined;
  const length = sessionEventCount(store, request.sessionId);
  if (request.seq < 1 || request.seq > length) return undefined;

  const targetIndex = request.seq - 1;
  const from = Math.max(0, targetIndex - request.before);
  const toExclusive = Math.min(length, targetIndex + request.after + 1);
  const slice = readSessionEvents(
    store,
    request.sessionId,
    SessionLogOffset(from),
    SessionLogOffset(toExclusive),
  );
  const events: SessionEventWindowRow[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const event = slice[i]!;
    events.push(toRow(event, from + i + 1));
  }
  return {
    sessionId: request.sessionId,
    seq: request.seq,
    startSeq: from + 1,
    endSeq: toExclusive,
    events,
  };
}
