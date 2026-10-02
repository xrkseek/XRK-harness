import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NON_RETRYABLE_CODES,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  LlmError,
  failureFromUnknown,
  isRetryableFailure,
  resolveStreamIdleTimeoutMs,
  withExtraAbortSignal,
  withStreamIdleTimeout,
} from "../src/index.js";

/** Stream whose events the test pushes by hand; parks forever when idle. */
function controlledSource<T>(): {
  readonly source: AsyncIterable<T>;
  readonly emit: (value: T) => void;
  readonly close: () => void;
  readonly released: () => boolean;
} {
  const pending: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let released = false;
  const source = (async function* (): AsyncGenerator<T> {
    try {
      while (true) {
        if (!pending.length && !closed) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (pending.length) {
          yield pending.shift() as T;
          continue;
        }
        if (closed) return;
      }
    } finally {
      released = true;
    }
  })();
  const nudge = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  return {
    source,
    emit: (value) => {
      pending.push(value);
      nudge();
    },
    close: () => {
      closed = true;
      nudge();
    },
    released: () => released,
  };
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = [];
  for await (const value of stream) seen.push(value);
  return seen;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stream idle watchdog", () => {
  it("defaults to 5 minutes, like Codex DEFAULT_STREAM_IDLE_TIMEOUT_MS", () => {
    expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(300_000);
    // `unwrap_or(DEFAULT_…)`: absent, zero, negative and Infinity all take
    // the internal default — never "no watchdog".
    for (const value of [undefined, 0, -1, Number.POSITIVE_INFINITY, NaN]) {
      expect(resolveStreamIdleTimeoutMs(value)).toBe(300_000);
    }
    expect(resolveStreamIdleTimeoutMs(1_500)).toBe(1_500);
  });

  it("throws a retryable TIMEOUT when the body goes silent", async () => {
    vi.useFakeTimers();
    const { source } = controlledSource<string>();
    const outcome = drain(
      withStreamIdleTimeout(source, {
        idleTimeoutMs: 1_000,
        label: "openai-compatible",
      }),
    ).then(
      () => undefined,
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(999);
    // Still alive one tick before the budget: the watchdog is not a wall-clock
    // cap on the whole stream.
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({
      name: "LlmError",
      code: "TIMEOUT",
      message: "openai-compatible: idle timeout waiting for stream",
    });
    // The retry policy is a blacklist, so TIMEOUT must not be on it — this is
    // what lets a silent stream recover on the next attempt.
    expect(DEFAULT_NON_RETRYABLE_CODES).not.toContain("TIMEOUT");
    expect(
      isRetryableFailure(
        failureFromUnknown(
          new LlmError("openai-compatible: idle timeout waiting for stream", "TIMEOUT"),
        ),
      ),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("measures idle per event, not per stream", async () => {
    vi.useFakeTimers();
    let produced = 0;
    async function* steady(): AsyncGenerator<number> {
      while (produced < 5) {
        produced += 1;
        yield produced;
      }
    }

    const iter = withStreamIdleTimeout(steady(), {
      idleTimeoutMs: 1_000,
      label: "gemini",
    })[Symbol.asyncIterator]();

    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      // 900 ms of silence per event, 5 events: 4.5 s of wall clock against a
      // 1 s budget. A whole-stream cap would have fired on event 2.
      const next = iter.next();
      await vi.advanceTimersByTimeAsync(900);
      const result = await next;
      expect(result.done).toBe(false);
      seen.push(result.value as number);
    }

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect((await iter.next()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer on every exit path", async () => {
    vi.useFakeTimers();
    // 1. Normal completion: the in-flight timer dies with the last event.
    const normal = controlledSource<string>();
    normal.emit("a");
    const normalStream = withStreamIdleTimeout(normal.source, {
      idleTimeoutMs: 5_000,
      label: "x",
    })[Symbol.asyncIterator]();
    const normalNext = normalStream.next();
    expect(vi.getTimerCount()).toBe(1);
    expect((await normalNext).value).toBe("a");
    expect(vi.getTimerCount()).toBe(0);
    normal.close();
    expect((await normalStream.next()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // 2. Consumer `break`: the generator's finally runs, which closes the
    // source. A 5-minute timer left armed here would pin the Electron main
    // process open long after the turn ended.
    const broken = controlledSource<string>();
    broken.emit("a");
    const received: string[] = [];
    const pump = (async () => {
      for await (const value of withStreamIdleTimeout(broken.source, {
        idleTimeoutMs: 5_000,
        label: "x",
      })) {
        received.push(value);
        break;
      }
    })();
    await pump;
    expect(received).toEqual(["a"]);
    expect(broken.released()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // 3. Timeout: the abandoned `next()` must not leave its timer behind, and
    // its eventual rejection must not become an unhandled rejection.
    const silent = controlledSource<string>();
    const timedOut = drain(
      withStreamIdleTimeout(silent.source, { idleTimeoutMs: 50, label: "x" }),
    ).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(50);
    expect(await timedOut).toMatchObject({ code: "TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts as a normal end, never as a timeout", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const { source } = controlledSource<string>();
    const pending = drain(
      withStreamIdleTimeout(source, {
        idleTimeoutMs: 5_000,
        label: "anthropic",
        signal: ac.signal,
      }),
    );
    // Source is parked on an event that never comes; the cancel must win
    // without waiting out the budget.
    ac.abort();
    await expect(pending).resolves.toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts iterating an already-aborted request", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    ac.abort();
    const { source, released } = controlledSource<string>();
    const stream = withStreamIdleTimeout(source, {
      idleTimeoutMs: 5_000,
      label: "openai-responses",
      signal: ac.signal,
    });
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    // The source was never advanced, so the cancel short-circuits before any
    // provider I/O and before the budget is ever armed.
    expect(released()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the adapter abort the in-flight request on idle timeout", async () => {
    vi.useFakeTimers();
    const idle = new AbortController();
    const user = new AbortController();
    let fired = 0;
    const { source } = controlledSource<string>();

    const timedOut = drain(
      withStreamIdleTimeout(source, {
        idleTimeoutMs: 25,
        label: "gemini",
        signal: user.signal,
        onIdleTimeout: () => {
          fired += 1;
          idle.abort();
        },
      }),
    ).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(25);

    expect(await timedOut).toMatchObject({ code: "TIMEOUT" });
    expect(fired).toBe(1);
    expect(idle.signal.aborted).toBe(true);
    // A user cancel is still the caller's business, not the watchdog's.
    expect(user.signal.aborted).toBe(false);
  });
});

describe("withExtraAbortSignal", () => {
  it("folds a signal in without touching the caller's", () => {
    const user = new AbortController();
    const extra = new AbortController();
    const merged = withExtraAbortSignal({ signal: user.signal }, extra.signal);
    extra.abort();
    expect(merged.signal?.aborted).toBe(true);
    expect(user.signal.aborted).toBe(false);
  });

  it("adopts the extra signal when the request had none", () => {
    const extra = new AbortController();
    expect(withExtraAbortSignal({}, extra.signal).signal).toBe(extra.signal);
  });
});
