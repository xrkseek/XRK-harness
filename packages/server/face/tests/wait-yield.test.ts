import { describe, expect, it } from "vitest";
import {
  WAIT_YIELD_ABORT_KIND,
  createWaitYieldHub,
  isWaitYieldAbort,
  shouldSoftYieldWait,
} from "../src/wait-yield.js";

describe("WaitYieldHub", () => {
  it("attach / yield / dispose soft-detaches without stranding", () => {
    const hub = createWaitYieldHub();
    const a = hub.attach("parent", { kind: "wait_agent", label: "child-a" });
    expect(hub.isAttached("parent")).toBe(true);
    expect(hub.active("parent")?.kind).toBe("wait_agent");
    expect(a.signal.aborted).toBe(false);

    expect(hub.yield("parent")).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(isWaitYieldAbort(a.signal.reason)).toBe(true);
    expect(
      (a.signal.reason as { kind: string }).kind,
    ).toBe(WAIT_YIELD_ABORT_KIND);
    // Attachment stays until dispose so shouldSoftYieldWait still sees it.
    expect(hub.isAttached("parent")).toBe(true);

    a.dispose();
    expect(hub.isAttached("parent")).toBe(false);
    expect(hub.yield("parent")).toBe(false);
  });

  it("yield aborts every stacked attachment for the session", () => {
    const hub = createWaitYieldHub();
    const a = hub.attach("s", { kind: "wait_agent" });
    const b = hub.attach("s", { kind: "peer_wait", label: "peer" });
    expect(hub.yield("s")).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    a.dispose();
    b.dispose();
    expect(hub.isAttached("s")).toBe(false);
  });

  it("shouldSoftYieldWait: hard Stop wins over yield when both race", () => {
    const hub = createWaitYieldHub();
    const att = hub.attach("s", { kind: "subagent_foreground" });
    hub.yield("s");
    expect(
      shouldSoftYieldWait({
        yieldSignal: att.signal,
        turnSignal: undefined,
      }),
    ).toBe(true);

    const turn = new AbortController();
    turn.abort({ kind: "user" });
    expect(
      shouldSoftYieldWait({
        yieldSignal: att.signal,
        turnSignal: turn.signal,
      }),
    ).toBe(false);

    expect(
      shouldSoftYieldWait({
        yieldSignal: att.signal,
        pendingSteer: true,
      }),
    ).toBe(true);

    att.dispose();
  });

  it("subscribe + snapshotLive: yield clears live dock immediately", () => {
    const hub = createWaitYieldHub();
    const seen: Array<{
      sessionId: string;
      kind: string | undefined;
    }> = [];
    const off = hub.subscribe((sessionId, active) => {
      seen.push({ sessionId, kind: active?.kind });
    });

    const att = hub.attach("parent", { kind: "wait_agent", label: "c" });
    expect(seen.at(-1)).toEqual({ sessionId: "parent", kind: "wait_agent" });
    expect(hub.snapshotLive()).toEqual([
      { sessionId: "parent", active: { kind: "wait_agent", label: "c" } },
    ]);

    expect(hub.yield("parent")).toBe(true);
    expect(seen.at(-1)).toEqual({ sessionId: "parent", kind: undefined });
    expect(hub.snapshotLive()).toEqual([]);
    expect(hub.isAttached("parent")).toBe(true);

    att.dispose();
    expect(seen.at(-1)).toEqual({ sessionId: "parent", kind: undefined });
    expect(hub.isAttached("parent")).toBe(false);
    off();
  });
});

