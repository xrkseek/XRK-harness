/**
 * Face mux wire sequence brands — independent of Session log sequence brands.
 * Runtime values remain plain numbers; brands stop mixing mux clocks with log offsets.
 */

declare const FACE_MUX_SEQ: unique symbol;

/** Per-session Face mux frame sequence (1-based after the first `next`). */
export type FaceMuxSeq = number & { readonly [FACE_MUX_SEQ]: void };

function assertNonNegSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a non-negative safe integer, got ${String(value)}`);
  }
}

/** Admit a numeric value as a Face mux sequence. */
export function FaceMuxSeq(value: number): FaceMuxSeq {
  assertNonNegSafeInt(value, "FaceMuxSeq");
  return value as FaceMuxSeq;
}

export interface FaceSeqClock {
  next(sessionId: string): FaceMuxSeq;
  last(sessionId: string): FaceMuxSeq;
  /**
   * Raise the mux watermark to at least `seq` without walking `next` one-by-one.
   * Used when replaying history so long sessions do not O(maxSeq) spin.
   */
  ensureAtLeast(sessionId: string, seq: number): FaceMuxSeq;
}

export function createFaceSeqClock(): FaceSeqClock {
  const lastBySession = new Map<string, FaceMuxSeq>();
  return {
    next(sessionId) {
      const n = FaceMuxSeq((lastBySession.get(sessionId) ?? 0) + 1);
      lastBySession.set(sessionId, n);
      return n;
    },
    last(sessionId) {
      return lastBySession.get(sessionId) ?? FaceMuxSeq(0);
    },
    ensureAtLeast(sessionId, seq) {
      assertNonNegSafeInt(seq, "FaceMuxSeq");
      const cur = lastBySession.get(sessionId) ?? FaceMuxSeq(0);
      if (seq <= cur) return cur;
      const n = FaceMuxSeq(seq);
      lastBySession.set(sessionId, n);
      return n;
    },
  };
}
