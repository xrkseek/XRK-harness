import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { resolveForkCut } from "../src/fork-cut.js";

/** One synthetic turn: start + user row (+ end when closed). */
interface TurnSpec {
  readonly turnId: string;
  /** false = injected context (subagent / goal / IM), i.e. human-less. */
  readonly human: boolean;
  readonly closed: boolean;
}

function buildLog(turns: readonly TurnSpec[]): SessionEvent[] {
  const events: unknown[] = [];
  for (const turn of turns) {
    events.push({ type: "turn/start", turnId: turn.turnId, seq: 0, time: 0 });
    events.push({
      type: "user/message",
      turnId: turn.turnId,
      seq: 0,
      time: 0,
      content: [{ type: "text", text: "hi" }],
      ...(turn.human ? {} : { source: { kind: "goal" } }),
    });
    if (turn.closed) {
      events.push({ type: "turn/end", turnId: turn.turnId, seq: 0, time: 0 });
    }
  }
  return events as SessionEvent[];
}

/** Exclusive end index of the n-th turn (1-based) as built above. */
function endOfTurn(turn: number): number {
  return turn * 3;
}

describe("resolveForkCut beforeSeq trim", () => {
  it("keeps a mid-history injected turn from truncating everything behind it", () => {
    // human -> injected (goal wake) -> human. The injected turn sits in the
    // middle, so it belongs to the context; only a *trailing* human-less turn
    // may be dropped.
    const events = buildLog([
      { turnId: "t1", human: true, closed: true },
      { turnId: "t2", human: false, closed: true },
      { turnId: "t3", human: true, closed: true },
    ]);
    const cut = resolveForkCut(events, { beforeSeq: events.length });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(endOfTurn(3));
  });

  it("drops a trailing human-less turn", () => {
    const events = buildLog([
      { turnId: "t1", human: true, closed: true },
      { turnId: "t2", human: false, closed: true },
    ]);
    const cut = resolveForkCut(events, { beforeSeq: events.length });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(endOfTurn(1));
  });

  it("stops at an open trailing turn", () => {
    const events = buildLog([
      { turnId: "t1", human: true, closed: true },
      { turnId: "t2", human: true, closed: false },
    ]);
    const cut = resolveForkCut(events, { beforeSeq: events.length });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(endOfTurn(1));
  });

  it("returns nothing usable when every turn is injected", () => {
    const events = buildLog([{ turnId: "t1", human: false, closed: true }]);
    const cut = resolveForkCut(events, { beforeSeq: events.length });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(0);
  });

  it("keeps seed records ahead of an open turn when no human turn closed yet", () => {
    // `session.create` writes seed records (permission / preset) before any turn
    // framing. An edit-resubmit must not drop them, or the child loses the
    // durable path grants the truncate path rehydrates from the kept prefix.
    const events = [
      { type: "session/permission", ts: 1 },
      { type: "turn/start", ts: 2, turnId: "t1" },
      { type: "user/message", ts: 3, turnId: "t1", content: "hi" },
    ] as unknown as SessionEvent[];
    const cut = resolveForkCut(events, { beforeSeq: 3 });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(1);
  });

  it("stops at the last human-led turn when an abort-only turn sits between", () => {
    const events = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "a" },
      { type: "turn/end", ts: 3, turnId: "t1" },
      // Abort-only: no human user row, but closed.
      { type: "turn/start", ts: 4, turnId: "t2" },
      { type: "turn/end", ts: 5, turnId: "t2" },
      // The turn the edit actually cuts, still open at beforeSeq.
      { type: "turn/start", ts: 6, turnId: "t3" },
      { type: "user/message", ts: 7, turnId: "t3", content: "edit me" },
    ] as unknown as SessionEvent[];
    const cut = resolveForkCut(events, { beforeSeq: 6 });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(3);
  });
});

describe("resolveForkCut atSeq anchor", () => {
  it("cuts a mid-history turn on its own turn/end", () => {
    // The product UI used to gate branch to the tip only; the Host has always
    // anchored on the first turn/end at or after the wire seq.
    const events = buildLog([
      { turnId: "t1", human: true, closed: true },
      { turnId: "t2", human: true, closed: true },
    ]);
    const cut = resolveForkCut(events, { atSeq: 2 });
    if (!cut.ok) throw new Error(cut.message);
    expect(cut.cut).toBe(endOfTurn(1));
  });

  it("reports fork-unavailable while the turn containing the seq is open", () => {
    const events = buildLog([
      { turnId: "t1", human: true, closed: true },
      { turnId: "t2", human: true, closed: false },
    ]);
    const cut = resolveForkCut(events, { atSeq: 5 });
    expect(cut).toMatchObject({ ok: false, code: "fork-unavailable" });
  });
});
