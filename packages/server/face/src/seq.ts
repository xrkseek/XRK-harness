export interface FaceSeqClock {
  next(sessionId: string): number;
  last(sessionId: string): number;
}

export function createFaceSeqClock(): FaceSeqClock {
  const lastBySession = new Map<string, number>();
  return {
    next(sessionId) {
      const n = (lastBySession.get(sessionId) ?? 0) + 1;
      lastBySession.set(sessionId, n);
      return n;
    },
    last(sessionId) {
      return lastBySession.get(sessionId) ?? 0;
    },
  };
}
