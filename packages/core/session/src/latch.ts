/**
 * Session execution latches (Promise-based).
 * Semantics from OpenCode SessionRunCoordinator / Cline running gate —
 * see docs/session-latch.md and ADR-0003 / ADR-0004.
 * No Effect.
 */

export class SessionBusyError extends Error {
  readonly sessionId?: string;

  constructor(message = "session turn already in flight", sessionId?: string) {
    super(message);
    this.name = "SessionBusyError";
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/** Exclusive turn gate for one AgentHandle / one logical session runner. */
export interface TurnLatch {
  /** True while a `run` body is executing. */
  isActive(): boolean;
  /**
   * Run exclusive work. If already active → `SessionBusyError`.
   * `work` receives an AbortSignal aborted by `cancel()` or caller.
   */
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Abort the in-flight work (if any). Idle cancel is a no-op. */
  cancel(reason?: unknown): void;
}

export function createTurnLatch(options?: {
  readonly sessionId?: string;
}): TurnLatch {
  let controller: AbortController | undefined;
  let active = false;

  return {
    isActive() {
      return active;
    },

    async run(work) {
      if (active) {
        throw new SessionBusyError(
          "session turn already in flight",
          options?.sessionId,
        );
      }
      const ac = new AbortController();
      controller = ac;
      active = true;
      try {
        return await work(ac.signal);
      } finally {
        if (controller === ac) controller = undefined;
        active = false;
      }
    },

    cancel(reason?: unknown) {
      controller?.abort(reason);
    },
  };
}

export type DrainFn = (input: {
  readonly force: boolean;
  readonly signal: AbortSignal;
}) => Promise<void>;

/** Knobs for {@link SessionDrainLatch.cancel}. */
export interface SessionDrainCancelOptions {
  /**
   * Delivered as `AbortSignal.reason` on the drain body's signal, so callers
   * can tell a user stop from an internal teardown.
   */
  readonly cause?: unknown;
  /**
   * Bounded join. A drain body that ignores its signal (stuck tool, hung
   * workspace snapshot) must not pin the cancel RPC forever; after this
   * budget `cancel` resolves anyway. The entry is intentionally kept so a
   * later `wake` re-arms a follow-up drain once the stuck chain settles.
   */
  readonly timeoutMs?: number;
  /** Fired synchronously once the abort signal has been published. */
  readonly onAbort?: () => void;
}

/**
 * Per-session drain latch: run (join) / wake (coalesce) / cancel.
 * Host holds one instance per sessionId (Map).
 */
export interface SessionDrainLatch {
  isActive(): boolean;
  /**
   * Idle → start drain(force=true). Busy → join until current chain settles
   * (does not start a second concurrent drain).
   */
  run(): Promise<void>;
  /**
   * Idle → start drain(force=false). Busy → coalesce at most one follow-up
   * drain after the current owner settles. A stopping (cancelled) owner still
   * accumulates the wake: a message admitted during teardown must be drained
   * by the follow-up instead of sitting in the queue forever.
   */
  wake(): void;
  /**
   * Abort active drain, clear coalesced wake, await cleanup (optionally
   * bounded — see {@link SessionDrainCancelOptions}).
   */
  cancel(options?: SessionDrainCancelOptions): Promise<void>;
}

type Entry = {
  readonly done: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (err: unknown) => void;
  controller: AbortController;
  pendingWake: boolean;
  stopping: boolean;
};

export function createSessionDrainLatch(drain: DrainFn): SessionDrainLatch {
  let entry: Entry | undefined;

  const makeEntry = (): Entry => {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Prevent unhandled rejection if cancel races before anyone awaits.
    done.catch(() => {});
    return {
      done,
      resolve,
      reject,
      controller: new AbortController(),
      pendingWake: false,
      stopping: false,
    };
  };

  const start = (e: Entry, force: boolean) => {
    void (async () => {
      try {
        await drain({ force, signal: e.controller.signal });
        settle(e, undefined);
      } catch (err) {
        settle(e, err);
      }
    })();
  };

  const settle = (e: Entry, err: unknown) => {
    if (entry !== e) return;

    if (err === undefined && e.pendingWake) {
      e.pendingWake = false;
      e.controller = new AbortController();
      start(e, false);
      return;
    }

    // `stopping` must not veto the follow-up: cancel() aborts the current
    // chain, so any wake that landed after it is a *new* admit and still owes
    // a drain. Swallowing it here is what used to strand post-cancel messages.
    const followUp = e.pendingWake;
    if (followUp) {
      const next = makeEntry();
      entry = next;
      start(next, false);
    } else {
      entry = undefined;
    }

    if (err !== undefined) e.reject(err);
    else e.resolve();
  };

  return {
    isActive() {
      return entry !== undefined;
    },

    run() {
      if (entry !== undefined) {
        if (entry.stopping) {
          return entry.done.finally(() => this.run());
        }
        return entry.done;
      }
      const next = makeEntry();
      entry = next;
      start(next, true);
      return next.done;
    },

    wake() {
      if (entry !== undefined) {
        entry.pendingWake = true;
        return;
      }
      const next = makeEntry();
      entry = next;
      start(next, false);
    },

    async cancel(options) {
      const e = entry;
      if (!e) {
        options?.onAbort?.();
        return;
      }
      e.stopping = true;
      e.pendingWake = false;
      e.controller.abort(options?.cause);
      options?.onAbort?.();
      const timeoutMs = options?.timeoutMs;
      if (timeoutMs === undefined || !(timeoutMs > 0)) {
        try {
          await e.done;
        } catch {
          // drain may reject on abort; latch is clear either way
        }
        return;
      }
      // Bounded join. The entry stays installed on timeout, so `isActive()`
      // still tells the truth and the post-settle follow-up can pick up any
      // wake that arrived meanwhile.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        e.done.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
