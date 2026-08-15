/**
 * Per-session map of {@link createSessionDrainLatch}.
 * Host holds one hub; drain bodies promote pending admits one-per-`continueTurn`
 * (OpenCode coordinator semantics without Effect — docs/session-delivery.md §3,
 * docs/learn/opencode-session-runner.md).
 */

import {
  createSessionDrainLatch,
  type DrainFn,
  type SessionDrainLatch,
} from "./latch.js";

export interface SessionDrainHub {
  /** Lazily create / return the latch for a session. */
  latch(sessionId: string): SessionDrainLatch;
  /** Idle → force drain; busy → join until the owner chain settles. */
  run(sessionId: string): Promise<void>;
  /** Idle → non-force drain; busy → coalesce at most one follow-up. */
  wake(sessionId: string): void;
  cancel(sessionId: string): Promise<void>;
  isActive(sessionId: string): boolean;
  /** Drop idle latch entry (optional GC). Active latches are kept. */
  forget(sessionId: string): void;
}

export function createSessionDrainHub(options: {
  /** Factory invoked once per sessionId when first accessed. */
  readonly createDrain: (sessionId: string) => DrainFn;
}): SessionDrainHub {
  const latches = new Map<string, SessionDrainLatch>();

  const latch = (sessionId: string): SessionDrainLatch => {
    let existing = latches.get(sessionId);
    if (!existing) {
      existing = createSessionDrainLatch(options.createDrain(sessionId));
      latches.set(sessionId, existing);
    }
    return existing;
  };

  return {
    latch,
    run(sessionId) {
      return latch(sessionId).run();
    },
    wake(sessionId) {
      latch(sessionId).wake();
    },
    cancel(sessionId) {
      return latch(sessionId).cancel();
    },
    isActive(sessionId) {
      return latches.get(sessionId)?.isActive() ?? false;
    },
    forget(sessionId) {
      const L = latches.get(sessionId);
      if (L && !L.isActive()) latches.delete(sessionId);
    },
  };
}
