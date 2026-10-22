import { describe, expect, it } from "vitest";
import {
  raceDrainRunSlice,
  waitForSignalOrSlice,
  waitSessionDrainIdle,
} from "../src/wait-drain-idle.js";
import type { FaceDrain } from "../src/context.js";

describe("waitSessionDrainIdle", () => {
  it("times out Host drain.run without cancelling the join promise", async () => {
    let settled = false;
    const drain: FaceDrain = {
      wake() {},
      async cancel() {},
      isActive() {
        return true;
      },
      async run() {
        await new Promise(() => {});
        settled = true;
      },
    };
    await expect(
      waitSessionDrainIdle(
        { drain },
        "sess_x",
        { timeoutMs: 30, kind: "subagent" },
      ),
    ).rejects.toThrow(/subagent timed out waiting for session sess_x/);
    expect(settled).toBe(false);
  });
});

describe("raceDrainRunSlice", () => {
  it("returns when the slice elapses while run hangs", async () => {
    const started = Date.now();
    await raceDrainRunSlice({
      run: () => new Promise(() => {}),
      sliceMs: 25,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it("rethrows AbortError immediately when the signal aborts mid-slice", async () => {
    const ac = new AbortController();
    const pending = raceDrainRunSlice({
      run: () => new Promise(() => {}),
      sliceMs: 5_000,
      signal: ac.signal,
    });
    queueMicrotask(() => ac.abort());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("waitForSignalOrSlice", () => {
  it("returns when the slice elapses without a signal", async () => {
    const started = Date.now();
    await waitForSignalOrSlice({ sliceMs: 25 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it("throws AbortError when the signal aborts mid-slice", async () => {
    const ac = new AbortController();
    const pending = waitForSignalOrSlice({
      sliceMs: 5_000,
      signal: ac.signal,
    });
    queueMicrotask(() => ac.abort());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      waitForSignalOrSlice({ sliceMs: 5_000, signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
