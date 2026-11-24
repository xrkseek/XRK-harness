/**
 * Soft-detach for wait-class tool bodies (Codex / job.background posture).
 *
 * User 「停止等待」 or a parent steer aborts the attached yield signal so the
 * wait settles with a status receipt. Children / peers keep running; answers
 * still arrive later via steer handoff. Hard Stop stays on the turn AbortSignal.
 */

import { combineAbortSignals } from "@xrkseek/protocol";

/** Abort reason kind stamped by {@link WaitYieldHub.yield}. */
export const WAIT_YIELD_ABORT_KIND = "wait-yield" as const;

export type WaitYieldKind =
  | "wait_agent"
  | "peer_wait"
  | "subagent_foreground";

export type WaitYieldActive = {
  readonly kind: WaitYieldKind;
  readonly label?: string | undefined;
};

export type WaitYieldAttachment = {
  readonly signal: AbortSignal;
  readonly meta: WaitYieldActive;
  dispose(): void;
};

/** Fires after attach / dispose / yield so Host can mirror UI dock state. */
export type WaitYieldListener = (
  sessionId: string,
  active: WaitYieldActive | undefined,
) => void;

export type WaitYieldHub = {
  /**
   * Register while a wait body runs. Multiple attaches stack; `yield` aborts
   * every live attachment for the session. `dispose` drops one.
   */
  attach(sessionId: string, meta: WaitYieldActive): WaitYieldAttachment;
  /** Soft-detach; true when at least one wait was attached. */
  yield(sessionId: string): boolean;
  /** First non-aborted attachment meta (UI / status), if any. */
  active(sessionId: string): WaitYieldActive | undefined;
  /** True while any wait body is attached for this session (incl. post-yield). */
  isAttached(sessionId: string): boolean;
  /** Subscribe to attach/dispose/yield transitions; returns unsubscribe. */
  subscribe(listener: WaitYieldListener): () => void;
  /**
   * Non-aborted wait dock rows for host-stream baseline (reconnect).
   * Post-yield aborted attachments are omitted so the dock stays clear.
   */
  snapshotLive(): readonly {
    readonly sessionId: string;
    readonly active: WaitYieldActive;
  }[];
};

type Entry = {
  readonly controller: AbortController;
  readonly meta: WaitYieldActive;
};

/** Dock mirror: only non-aborted attachments (yield clears the dock immediately). */
function firstLiveMeta(live: Set<Entry> | undefined): WaitYieldActive | undefined {
  if (!live || live.size === 0) return undefined;
  for (const entry of live) {
    if (!entry.controller.signal.aborted) return entry.meta;
  }
  return undefined;
}

export function createWaitYieldHub(): WaitYieldHub {
  const bySession = new Map<string, Set<Entry>>();
  const listeners = new Set<WaitYieldListener>();

  const notify = (sessionId: string): void => {
    if (listeners.size === 0) return;
    const active = firstLiveMeta(bySession.get(sessionId));
    for (const listener of listeners) {
      try {
        listener(sessionId, active);
      } catch {
        /* UI mirror must not break wait bodies */
      }
    }
  };

  return {
    attach(sessionId, meta) {
      const id = sessionId.trim();
      if (!id) {
        const controller = new AbortController();
        return {
          signal: controller.signal,
          meta,
          dispose() {},
        };
      }
      const controller = new AbortController();
      const entry: Entry = { controller, meta };
      let set = bySession.get(id);
      if (!set) {
        set = new Set();
        bySession.set(id, set);
      }
      set.add(entry);
      notify(id);
      let disposed = false;
      return {
        signal: controller.signal,
        meta,
        dispose() {
          if (disposed) return;
          disposed = true;
          const live = bySession.get(id);
          if (!live) return;
          live.delete(entry);
          if (live.size === 0) bySession.delete(id);
          notify(id);
        },
      };
    },

    yield(sessionId) {
      const id = sessionId.trim();
      if (!id) return false;
      const live = bySession.get(id);
      if (!live || live.size === 0) return false;
      for (const entry of live) {
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(
            Object.freeze({ kind: WAIT_YIELD_ABORT_KIND }),
          );
        }
      }
      // Still attached until dispose (shouldSoftYieldWait); dock clears via live meta.
      notify(id);
      return true;
    },

    active(sessionId) {
      return firstLiveMeta(bySession.get(sessionId.trim()));
    },

    isAttached(sessionId) {
      const live = bySession.get(sessionId.trim());
      return live !== undefined && live.size > 0;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshotLive() {
      const out: { sessionId: string; active: WaitYieldActive }[] = [];
      for (const [sessionId, live] of bySession) {
        const active = firstLiveMeta(live);
        if (active) out.push({ sessionId, active });
      }
      return out;
    },
  };
}

/** True when an AbortError / abort reason came from {@link WaitYieldHub.yield}. */
export function isWaitYieldAbort(reason: unknown): boolean {
  if (reason !== null && typeof reason === "object" && "kind" in reason) {
    return (reason as { kind?: unknown }).kind === WAIT_YIELD_ABORT_KIND;
  }
  return false;
}

/**
 * Soft-yield vs hard cancel after a raced wait slice throws AbortError.
 *
 * Hard Stop wins when the turn signal is aborted for a non-yield reason
 * (even if yield also fired). Otherwise: yield signal, pending steer
 * (插队 admitted before the wait attached), or AbortError cause.
 */
export function shouldSoftYieldWait(input: {
  readonly yieldSignal?: AbortSignal | undefined;
  readonly turnSignal?: AbortSignal | undefined;
  readonly err?: unknown;
  /** Steer already in inbox — covers yield() before attach. */
  readonly pendingSteer?: boolean | undefined;
}): boolean {
  if (
    input.turnSignal?.aborted &&
    !isWaitYieldAbort(input.turnSignal.reason)
  ) {
    return false;
  }
  if (input.yieldSignal?.aborted) return true;
  if (input.pendingSteer) return true;
  if (input.err instanceof Error && input.err.name === "AbortError") {
    return isWaitYieldAbort(
      (input.err as { cause?: unknown }).cause ?? input.yieldSignal?.reason,
    );
  }
  return false;
}

/** Merge turn cancel + wait-yield into one AbortSignal (omit empties). */
export function mergeWaitSignals(
  turn: AbortSignal | undefined,
  yieldSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (turn && yieldSignal) return combineAbortSignals([turn, yieldSignal]);
  return turn ?? yieldSignal;
}
