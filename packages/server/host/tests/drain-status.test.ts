import { describe, expect, it, vi } from "vitest";
import { createSessionDrainHub } from "@xrkseek/core-session";
import { publishDrainIdle, wireDrainStatus } from "../src/drain-status.js";

describe("wireDrainStatus", () => {
  it("publishes running:true on wake and running:false when drain settles", async () => {
    const frames: { sessionId: string; running: boolean }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hub = createSessionDrainHub({
      createDrain: (sessionId) => async () => {
        try {
          await gate;
        } finally {
          publishDrainIdle(hub, sessionId, (_sid, running) => {
            frames.push({ sessionId, running });
          });
        }
      },
    });
    const drain = wireDrainStatus(
      hub,
      (sessionId, running) => {
        frames.push({ sessionId, running });
      },
      new Map(),
    );

    drain.wake("s1");
    expect(frames).toEqual([{ sessionId: "s1", running: true }]);

    release();
    await vi.waitFor(() => {
      expect(frames.some((f) => f.running === false)).toBe(true);
    });
    expect(frames).toEqual([
      { sessionId: "s1", running: true },
      { sessionId: "s1", running: false },
    ]);
  });

  it("does not republish running:true while coalesced wake keeps latch active", async () => {
    const frames: { sessionId: string; running: boolean }[] = [];
    const hub = createSessionDrainHub({
      createDrain: (sessionId) => async ({ signal }) => {
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 30);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
        } finally {
          publishDrainIdle(hub, sessionId, (_sid, running) => {
            frames.push({ sessionId, running });
          });
        }
      },
    });
    const drain = wireDrainStatus(
      hub,
      (sessionId, running) => {
        frames.push({ sessionId, running });
      },
      new Map(),
    );

    drain.wake("s1");
    drain.wake("s1");
    await vi.waitFor(() => {
      expect(frames.some((f) => f.running === false)).toBe(true);
    });
    expect(frames.filter((f) => f.running)).toHaveLength(1);
    expect(frames.at(-1)).toEqual({ sessionId: "s1", running: false });
  });
});
