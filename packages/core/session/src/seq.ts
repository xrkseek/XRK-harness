/**
 * Session log position brands and read accessors.
 * Runtime values remain plain numbers; brands stop mixing event indices with gaps.
 */
import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionRecord, SessionStore } from "./store.js";

declare const SESSION_SEQ: unique symbol;
declare const SESSION_LOG_OFFSET: unique symbol;

/** Sequence number of one existing event in a Session log. */
export type SessionSeq = number & { readonly [SESSION_SEQ]: void };

/** A Session log gap, prefix length, or read offset (may equal the event count). */
export type SessionLogOffset = number & { readonly [SESSION_LOG_OFFSET]: void };

/** Inclusive watermark, or `-1` before any event exists. */
export type SessionSeqCursor = SessionSeq | -1;

/** Minimum store surface for log reads (SessionStore implements this). */
export type SessionLogReader = Pick<SessionStore, "readEvents">;

function assertNonNegSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a non-negative safe integer, got ${String(value)}`);
  }
}

/**
 * Admit a numeric value as an existing Session event position.
 * @param value - non-negative safe integer admitted by the owning log operation.
 */
export function SessionSeq(value: number): SessionSeq {
  assertNonNegSafeInt(value, "SessionSeq");
  return value as SessionSeq;
}

/**
 * Admit a numeric value as a Session log offset.
 * @param value - non-negative safe integer used as a gap or prefix length.
 */
export function SessionLogOffset(value: number): SessionLogOffset {
  assertNonNegSafeInt(value, "SessionLogOffset");
  return value as SessionLogOffset;
}

/**
 * Admit a watermark: `-1` (empty log) or an existing {@link SessionSeq}.
 * @param value - `-1` or a non-negative safe integer.
 */
export function SessionSeqCursor(value: number): SessionSeqCursor {
  if (value === -1) return -1;
  return SessionSeq(value);
}

/**
 * Validate a half-open `[from, to)` against a known length.
 * Out-of-range bounds are allowed (same as `Array.prototype.slice`).
 * @param length - current event count.
 * @param fromSeq - inclusive start (default 0).
 * @param toSeqExclusive - exclusive end (default `length`).
 */
export function resolveHalfOpenEventRange(
  length: number,
  fromSeq: number = 0,
  toSeqExclusive?: number,
): { readonly from: SessionLogOffset; readonly to: SessionLogOffset } {
  assertNonNegSafeInt(length, "length");
  assertNonNegSafeInt(fromSeq, "fromSeq");
  const end = toSeqExclusive ?? length;
  if (toSeqExclusive !== undefined) {
    assertNonNegSafeInt(end, "toSeqExclusive");
  }
  return { from: SessionLogOffset(fromSeq), to: SessionLogOffset(end) };
}

/**
 * Materialize an immutable snapshot of a half-open event range.
 * Full-range requests reuse the record's existing `events` array identity.
 * @param record - session log record.
 * @param fromSeq - inclusive start (default 0).
 * @param toSeqExclusive - exclusive end (default event count).
 */
export function snapshotEvents(
  record: SessionRecord,
  fromSeq: number = 0,
  toSeqExclusive?: number,
): readonly SessionEvent[] {
  const { from, to } = resolveHalfOpenEventRange(
    record.events.length,
    fromSeq,
    toSeqExclusive,
  );
  if (from === 0 && to === record.events.length) {
    return record.events;
  }
  return record.events.slice(from, to);
}

/**
 * Canonical store-facing range read (typed offsets).
 * Always delegates to {@link SessionStore.readEvents}.
 * @param store - session store.
 * @param sessionId - session id.
 * @param fromSeq - inclusive start (default 0).
 * @param toSeqExclusive - exclusive end (default event count).
 */
export function readSessionEvents(
  store: SessionLogReader,
  sessionId: string,
  fromSeq: SessionLogOffset = SessionLogOffset(0),
  toSeqExclusive?: SessionLogOffset,
): readonly SessionEvent[] {
  return store.readEvents(sessionId, fromSeq, toSeqExclusive);
}

/**
 * Current log length as a typed offset (next append index).
 * @param record - session log record.
 */
export function eventCount(record: SessionRecord): SessionLogOffset {
  return SessionLogOffset(record.events.length);
}

/**
 * Store-facing log length (next append index).
 * @param store - session store.
 * @param sessionId - session id.
 */
export function sessionEventCount(
  store: SessionLogReader,
  sessionId: string,
): SessionLogOffset {
  return SessionLogOffset(store.readEvents(sessionId).length);
}

/**
 * Return the event at one exact sequence number, or undefined when absent.
 * @param record - session log record.
 * @param seq - event sequence number.
 */
export function eventAt(
  record: SessionRecord,
  seq: SessionSeq,
): SessionEvent | undefined {
  return record.events[seq];
}

/**
 * Store-facing single-event read (hydrates via `readEvents` when cold).
 * @param store - session store.
 * @param sessionId - session id.
 * @param seq - event sequence number.
 */
export function sessionEventAt(
  store: SessionLogReader,
  sessionId: string,
  seq: SessionSeq,
): SessionEvent | undefined {
  return store.readEvents(
    sessionId,
    seq,
    SessionLogOffset(seq + 1),
  )[0];
}

/**
 * Last event in the log, or undefined when empty.
 * @param store - session store.
 * @param sessionId - session id.
 */
export function lastSessionEvent(
  store: SessionLogReader,
  sessionId: string,
): SessionEvent | undefined {
  const events = store.readEvents(sessionId);
  return events.length === 0 ? undefined : events[events.length - 1];
}

/**
 * Half-open suffix from `fromSeq` to the end of the log.
 * @param store - session store.
 * @param sessionId - session id.
 * @param fromSeq - inclusive start.
 */
export function sessionEventsFrom(
  store: SessionLogReader,
  sessionId: string,
  fromSeq: SessionLogOffset,
): readonly SessionEvent[] {
  return store.readEvents(sessionId, fromSeq);
}
