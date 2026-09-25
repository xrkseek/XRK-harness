/**
 * Per-session map of {@link createSessionDrainLatch}.
 * Host holds one hub; drain bodies promote pending admits one-per-`continueTurn`
 * (OpenCode coordinator semantics without Effect — docs/session-delivery.md §3).
 */

import {
  createSessionDrainLatch,
  type DrainFn,
  type SessionDrainCancelOptions,
  type SessionDrainLatch,
} from "./latch.js";

export interface SessionDrainHub {
  /** Lazily create / return the latch for a session. */
  latch(sessionId: string): SessionDrainLatch;
  /** Idle → force drain; busy → join until the owner chain settles. */
  run(sessionId: string): Promise<void>;
  /** Idle → non-force drain; busy → coalesce at most one follow-up. */
  wake(sessionId: string): void;
  cancel(sessionId: string, options?: SessionDrainCancelOptions): Promise<void>;
  isActive(sessionId: string): boolean;
  /** Session ids whose latch is currently draining (Host MCP mid-drain skip). */
  activeIds(): readonly string[];
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
    cancel(sessionId, options) {
      return latch(sessionId).cancel(options);
    },
    isActive(sessionId) {
      return latches.get(sessionId)?.isActive() ?? false;
    },
    activeIds() {
      const ids: string[] = [];
      for (const [id, L] of latches) {
        if (L.isActive()) ids.push(id);
      }
      return ids;
    },
    forget(sessionId) {
      const L = latches.get(sessionId);
      if (L && !L.isActive()) latches.delete(sessionId);
    },
  };
}
