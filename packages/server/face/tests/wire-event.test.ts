import { describe, expect, it } from "vitest";
import {
  FaceWireIdMaps,
  presentToolView,
  toFaceWireSessionEvent,
  wireNumericId,
} from "../src/adapt/index.js";

describe("Face DSH wire-event adapt", () => {
  it("wireNumericId is stable and maps numeric strings as numbers", () => {
    expect(wireNumericId("1")).toBe(1);
    expect(wireNumericId("turn_abc")).toBe(wireNumericId("turn_abc"));
    expect(wireNumericId("a")).not.toBe(wireNumericId("b"));
  });

  it("FaceWireIdMaps assigns monotonic turn/step per session", () => {
    const ids = new FaceWireIdMaps();
    expect(ids.turn("s1", "t-a")).toBe(1);
    expect(ids.turn("s1", "t-b")).toBe(2);
    expect(ids.turn("s1", "t-a")).toBe(1);
    expect(ids.step("s1", "t-a", "s-x")).toBe(1);
    expect(ids.step("s1", "t-a", "s-y")).toBe(2);
    expect(ids.step("s1", "t-b", "s-x")).toBe(1);
    expect(ids.turn("s2", "t-a")).toBe(1);
  });

  it("user/message carries content blocks + source.kind user", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "user/message",
        ts: 10,
        turnId: "t1",
        content: "hello",
        rpcId: "rpc-1",
      },
      3,
    );
    expect(wire).toEqual({
      type: "user/message",
      seq: 3,
      time: 10,
      surfaceOp: "append",
      data: {
        id: "t1",
        content: [{ type: "text", text: "hello" }],
        source: { kind: "user" },
        rpcId: "rpc-1",
      },
    });
  });

  it("assistant/message and tool/result stamp surfaceOp append for client fold", () => {
    expect(
      toFaceWireSessionEvent(
        {
          type: "assistant/message",
          ts: 11,
          turnId: "t1",
          stepId: "s1",
          content: "hi",
        },
        4,
      ).surfaceOp,
    ).toBe("append");
    expect(
      toFaceWireSessionEvent(
        {
          type: "tool/result",
          ts: 12,
          turnId: "t1",
          stepId: "s1",
          result: {
            toolCallId: "c1",
            name: "todo_write",
            content: "ok",
          },
        },
        5,
      ).surfaceOp,
    ).toBe("append");
  });

  it("assistant/chunk uses text-delta; maps turn/step when ctx.ids set", () => {
    const ids = new FaceWireIdMaps();
    const wire = toFaceWireSessionEvent(
      {
        type: "assistant/chunk",
        ts: 11,
        turnId: "t1",
        stepId: "s1",
        text: "hi",
      },
      4,
      { sessionId: "sess", ids },
    );
    expect(wire.data).toEqual({
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: "hi" },
    });
  });

  it("assistant/chunk kind=reasoning maps to reasoning-delta index 0", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "assistant/chunk",
        ts: 11,
        turnId: "t1",
        stepId: "s1",
        text: "think",
        kind: "reasoning",
        index: 0,
      },
      4,
    );
    expect(wire.data).toEqual({
      turn: expect.any(Number),
      step: expect.any(Number),
      chunk: { type: "reasoning-delta", index: 0, text: "think" },
    });
  });

  it("assistant/message prepends reasoning block when present", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "assistant/message",
        ts: 12,
        turnId: "t1",
        stepId: "s1",
        content: "done",
        reasoning: "plan",
      },
      5,
    );
    const data = wire.data as { message: { content: { type: string; text?: string }[] } };
    expect(data.message.content[0]).toEqual({ type: "reasoning", text: "plan" });
    expect(data.message.content[1]).toEqual({ type: "text", text: "done" });
  });

  it("assistant/message content includes text + tool-call blocks", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "assistant/message",
        ts: 12,
        turnId: "t1",
        stepId: "s1",
        content: "done",
        toolCalls: [{ id: "c1", name: "bash", arguments: { cmd: "ls" } }],
      },
      5,
      { sessionId: "sess", ids: new FaceWireIdMaps() },
    );
    const data = wire.data as {
      message: { content: { type: string }[]; source: { provider: string } };
    };
    expect(data.message.content[0]).toEqual({ type: "text", text: "done" });
    expect(data.message.content[1]).toMatchObject({
      type: "tool-call",
      id: "c1",
      name: "bash",
    });
    expect(data.message.source).toEqual({ provider: "xrk", model: "unknown" });
  });

  it("tool/call is flat callId/name/arguments; view uses for/card", () => {
    const event = {
      type: "tool/call" as const,
      ts: 12,
      turnId: "t1",
      stepId: "s1",
      call: { id: "c9", name: "bash", arguments: { cmd: "pwd" } },
    };
    const wire = toFaceWireSessionEvent(event, 5);
    expect(wire.data).toMatchObject({
      callId: "c9",
      name: "bash",
      arguments: '{"cmd":"pwd"}',
    });
    expect(wire.data).not.toHaveProperty("call");
    expect(presentToolView(event)).toBeUndefined();
    expect(
      presentToolView(event, {
        getTool: (name) =>
          name === "bash"
            ? {
                presentCall: (args) => ({
                  card: "terminal",
                  title: String((args as { cmd?: string }).cmd ?? ""),
                }),
              }
            : undefined,
      }),
    ).toEqual({
      for: "call",
      view: {
        card: "terminal",
        title: "pwd",
      },
    });
  });

  it("tool/result nests message.content + source.callId", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "tool/result",
        ts: 13,
        turnId: "t1",
        stepId: "s1",
        result: {
          toolCallId: "c9",
          name: "bash",
          content: "ok",
          isError: false,
        },
      },
      6,
    );
    expect(wire.data).toMatchObject({
      message: {
        content: [{ content: [{ type: "text", text: "ok" }] }],
        source: { callId: "c9" },
      },
    });
  });

  it("turn/end preserves stored reason on wire", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "turn/end",
        ts: 16,
        turnId: "t1",
        reason: {
          kind: "error",
          error: { code: "RATE_LIMIT", message: "slow down" },
        },
      },
      9,
      { sessionId: "sess", ids: new FaceWireIdMaps() },
    );
    expect(wire.data).toEqual({
      turn: 1,
      reason: {
        kind: "error",
        error: { code: "RATE_LIMIT", message: "slow down" },
      },
    });
  });

  it("session/title data matches DSH title fold fields", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "session/title",
        ts: 14,
        title: "My title",
        source: { kind: "user" },
        messageSeqs: [],
      },
      7,
    );
    expect(wire.data).toEqual({
      title: "My title",
      messageSeqs: [],
      source: { kind: "user" },
    });
  });

  it("prompt/* without projector are ignorable; with projector become spliced", () => {
    const bare = toFaceWireSessionEvent(
      {
        type: "prompt/admitted",
        ts: 20,
        admitId: "a1",
        content: "hi",
      },
      8,
    );
    expect(bare.ignorable).toBe(true);
    expect(bare.type).toBe("prompt/admitted");
  });

  it("todo/write carries data.todos (DSH standing-plan event)", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "todo/write",
        ts: 30,
        todos: [{ content: "ship", status: "in_progress" }],
      },
      9,
    );
    expect(wire).toEqual({
      type: "todo/write",
      seq: 9,
      time: 30,
      data: { todos: [{ content: "ship", status: "in_progress" }] },
    });
  });

  it("feedback/record is ignorable (shell has no dedicated card)", () => {
    const wire = toFaceWireSessionEvent(
      {
        type: "feedback/record",
        ts: 40,
        text: "the diff view is unreadable",
      },
      10,
    );
    expect(wire).toEqual({
      type: "feedback/record",
      seq: 10,
      time: 40,
      data: { text: "the diff view is unreadable" },
      ignorable: true,
    });
  });
});
