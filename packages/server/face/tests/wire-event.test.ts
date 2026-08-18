import { describe, expect, it } from "vitest";
import {
  FaceWireIdMaps,
  presentToolView,
  toDshWireSessionEvent,
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
    const wire = toDshWireSessionEvent(
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
      data: {
        id: "t1",
        content: [{ type: "text", text: "hello" }],
        source: { kind: "user" },
        rpcId: "rpc-1",
      },
    });
  });

  it("assistant/chunk uses text-delta; maps turn/step when ctx.ids set", () => {
    const ids = new FaceWireIdMaps();
    const wire = toDshWireSessionEvent(
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
    const wire = toDshWireSessionEvent(
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
    const wire = toDshWireSessionEvent(
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
    const wire = toDshWireSessionEvent(
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
    const wire = toDshWireSessionEvent(event, 5);
    expect(wire.data).toMatchObject({
      callId: "c9",
      name: "bash",
      arguments: { cmd: "pwd" },
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
    const wire = toDshWireSessionEvent(
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

  it("session/title data matches DSH title fold fields", () => {
    const wire = toDshWireSessionEvent(
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
    const bare = toDshWireSessionEvent(
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
});
