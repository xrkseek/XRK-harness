import { describe, expect, it } from "vitest";
import { coerceSessionEvent } from "../src/face-wire.js";

describe("coerceSessionEvent", () => {
  it("passes through XRK SessionEvent", () => {
    const ev = {
      type: "user/message" as const,
      ts: 1,
      turnId: "t1",
      content: "hi",
    };
    expect(coerceSessionEvent(ev)).toEqual(ev);
  });

  it("decodes Face wire user/message + assistant/chunk", () => {
    const user = coerceSessionEvent({
      type: "user/message",
      seq: 1,
      time: 10,
      data: {
        id: "turn-a",
        content: [{ type: "text", text: "ping" }],
        rpcId: "rpc1",
      },
    });
    expect(user).toMatchObject({
      type: "user/message",
      turnId: "turn-a",
      content: [{ type: "text", text: "ping" }],
      rpcId: "rpc1",
    });

    const chunk = coerceSessionEvent({
      type: "assistant/chunk",
      seq: 2,
      time: 11,
      data: {
        turn: 3,
        step: 4,
        chunk: { type: "text-delta", index: 0, text: "pong" },
      },
    });
    expect(chunk).toMatchObject({
      type: "assistant/chunk",
      turnId: "3",
      stepId: "4",
      text: "pong",
    });
  });

  it("skips ignorable wire rows", () => {
    expect(
      coerceSessionEvent({
        type: "prompt/admitted",
        seq: 1,
        time: 1,
        data: {},
        ignorable: true,
      }),
    ).toBeNull();
  });
});
