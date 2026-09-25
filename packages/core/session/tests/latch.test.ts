import { describe, expect, it, vi } from "vitest";
import {
  SessionBusyError,
  createSessionDrainLatch,
  createTurnLatch,
} from "../src/latch.js";

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("createTurnLatch", () => {
  it("runs exclusive work", async () => {
    const latch = createTurnLatch();
    const out = await latch.run(async () => 42);
    expect(out).toBe(42);
    expect(latch.isActive()).toBe(false);
  });

  it("rejects concurrent run", async () => {
    const latch = createTurnLatch({ sessionId: "s1" });
    let release!: () => void;
    const block = new Promise<void>((r) => {
      release = r;
    });

    const first = latch.run(async () => {
      await block;
      return "a";
    });

    await expect(latch.run(async () => "b")).rejects.toMatchObject({
      name: "SessionBusyError",
      sessionId: "s1",
    });
    expect(latch.isActive()).toBe(true);

    release();
    await expect(first).resolves.toBe("a");
    expect(latch.isActive()).toBe(false);
  });

  it("cancel aborts signal", async () => {
    const latch = createTurnLatch();
    const sawAbort = latch.run(async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    latch.cancel({ kind: "user" });
    await expect(sawAbort).rejects.toMatchObject({ name: "AbortError" });
    expect(latch.isActive()).toBe(false);
  });

  it("cancel forwards AbortSignal.reason", async () => {
    const latch = createTurnLatch();
    let reason: unknown;
    const sawAbort = latch.run(async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reason = signal.reason;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    latch.cancel({ kind: "disposed" });
    await expect(sawAbort).rejects.toMatchObject({ name: "AbortError" });
    expect(reason).toEqual({ kind: "disposed" });
  });

  it("allows run after previous finishes", async () => {
    const latch = createTurnLatch();
    await latch.run(async () => 1);
    await expect(latch.run(async () => 2)).resolves.toBe(2);
  });
});

describe("createSessionDrainLatch", () => {
  it("run starts forced drain and join waits", async () => {
    const calls: boolean[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const latch = createSessionDrainLatch(async ({ force, signal }) => {
      calls.push(force);
      await gate;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    });

    const a = latch.run();
    expect(latch.isActive()).toBe(true);
    const b = latch.run(); // join
    release();
    await Promise.all([a, b]);
    expect(calls).toEqual([true]);
    expect(latch.isActive()).toBe(false);
  });

  it("wake coalesces while busy then drains once after", async () => {
    const forces: boolean[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let secondStarted = false;
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((r) => {
      releaseSecond = r;
    });

    const latch = createSessionDrainLatch(async ({ force }) => {
      forces.push(force);
      if (forces.length === 1) {
        await firstGate;
        return;
      }
      secondStarted = true;
      await secondGate;
    });

    const runP = latch.run();
    latch.wake();
    latch.wake(); // coalesce
    releaseFirst();
    await vi.waitFor(() => expect(secondStarted).toBe(true));
    releaseSecond();
    await runP;
    expect(forces).toEqual([true, false]);
    expect(latch.isActive()).toBe(false);
  });

  it("wake while idle starts non-forced drain", async () => {
    const forces: boolean[] = [];
    const latch = createSessionDrainLatch(async ({ force }) => {
      forces.push(force);
    });
    latch.wake();
    await vi.waitFor(() => expect(latch.isActive()).toBe(false));
    expect(forces).toEqual([false]);
  });

  it("cancel aborts and clears pending wake", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const forces: boolean[] = [];

    const latch = createSessionDrainLatch(async ({ force, signal }) => {
      forces.push(force);
      await Promise.race([
        gate,
        new Promise<never>((_, rej) => {
          signal.addEventListener(
            "abort",
            () => rej(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      ]);
    });

    const runP = latch.run();
    latch.wake();
    await latch.cancel();
    release();
    await expect(runP).rejects.toMatchObject({ name: "AbortError" });
    await delay(20);
    expect(forces).toEqual([true]);
    expect(latch.isActive()).toBe(false);
  });

  it("cancel forwards cause to drain signal.reason", async () => {
    let seen: unknown;
    const latch = createSessionDrainLatch(async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            seen = signal.reason;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    const runP = latch.run();
    await latch.cancel({ cause: { kind: "disposed" } });
    expect(seen).toEqual({ kind: "disposed" });
    await expect(runP).rejects.toMatchObject({ name: "AbortError" });
    expect(latch.isActive()).toBe(false);
  });

  it("cancel honors timeoutMs when the drain ignores its signal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let onAbortCalls = 0;
    const latch = createSessionDrainLatch(async () => {
      await gate; // never observes the abort signal
    });

    const runP = latch.run();
    const started = Date.now();
    await latch.cancel({
      timeoutMs: 30,
      onAbort: () => {
        onAbortCalls += 1;
      },
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(onAbortCalls).toBe(1);
    // The stuck entry is kept: the latch still tells the truth about
    // activity, and a later wake re-arms once the chain finally settles.
    expect(latch.isActive()).toBe(true);
    release();
    await runP;
    expect(latch.isActive()).toBe(false);
  });

  it("wake during cancel is not swallowed and re-drains after settle", async () => {
    const forces: boolean[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((r) => {
      releaseSecond = r;
    });

    const latch = createSessionDrainLatch(async ({ force, signal }) => {
      forces.push(force);
      if (forces.length === 1) {
        await Promise.race([
          firstGate,
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
        ]);
        return;
      }
      await secondGate;
    });

    const runP = latch.run();
    const cancelP = latch.cancel();
    // A message lands while teardown is in flight: it must drain afterwards,
    // never sit in the queue (the historical "post-cancel message stuck" bug).
    latch.wake();
    releaseFirst();
    await cancelP;
    await vi.waitFor(() => expect(forces.length).toBe(2));
    releaseSecond();
    await runP.catch(() => undefined); // first chain was aborted by cancel
    expect(forces).toEqual([true, false]);
    expect(latch.isActive()).toBe(false);
  });
});

describe("SessionBusyError", () => {
  it("is an Error subclass", () => {
    const e = new SessionBusyError("busy", "sid");
    expect(e).toBeInstanceOf(Error);
    expect(e.sessionId).toBe("sid");
  });
});
