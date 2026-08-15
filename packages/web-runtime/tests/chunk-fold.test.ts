import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { ChunkFold } from "../src/chunk-fold.js";

function ev<T extends SessionEvent>(partial: T): T {
  return partial;
}

describe("ChunkFold", () => {
  it("accumulates assistant/chunk as partial then clears on message", () => {
    const fold = new ChunkFold();
    fold.push(
      ev({
        type: "assistant/chunk",
        ts: 1,
        turnId: "t1",
        stepId: "s1",
        text: "Hel",
      }),
    );
    fold.push(
      ev({
        type: "assistant/chunk",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        text: "lo",
      }),
    );
    let snap = fold.getSnapshot();
    expect(snap.partialText).toBe("Hello");
    expect(snap.nodes).toEqual([
      {
        kind: "assistant",
        turnId: "t1",
        stepId: "s1",
        content: "Hello",
        partial: true,
      },
    ]);

    fold.push(
      ev({
        type: "assistant/message",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        content: "Hello!",
      }),
    );
    snap = fold.getSnapshot();
    expect(snap.partialText).toBe("");
    expect(snap.nodes).toEqual([
      {
        kind: "assistant",
        turnId: "t1",
        stepId: "s1",
        content: "Hello!",
      },
    ]);
  });

  it("folds user / tool / notice nodes", () => {
    const fold = new ChunkFold();
    fold.push(
      ev({
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "hi",
      }),
    );
    fold.push(
      ev({
        type: "tool/call",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        call: { id: "c1", name: "bash", arguments: { cmd: "ls" } },
      }),
    );
    fold.push(
      ev({
        type: "tool/result",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        result: {
          toolCallId: "c1",
          name: "bash",
          content: "ok",
        },
      }),
    );
    fold.push(
      ev({
        type: "safety/notice",
        ts: 4,
        turnId: "t1",
        kind: "api_error",
        content: "rate limit",
      }),
    );
    expect(fold.getSnapshot().nodes).toEqual([
      { kind: "user", turnId: "t1", content: "hi" },
      {
        kind: "tool",
        turnId: "t1",
        callId: "c1",
        name: "bash",
        phase: "call",
        detail: '{"cmd":"ls"}',
      },
      {
        kind: "tool",
        turnId: "t1",
        callId: "c1",
        name: "bash",
        phase: "result",
        detail: "ok",
      },
      { kind: "notice", content: "rate limit" },
    ]);
  });

  it("reset clears trajectory on generation bump", () => {
    const fold = new ChunkFold();
    fold.push(
      ev({
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "x",
      }),
    );
    fold.reset();
    expect(fold.getSnapshot()).toEqual({ nodes: [], partialText: "" });
  });
});
