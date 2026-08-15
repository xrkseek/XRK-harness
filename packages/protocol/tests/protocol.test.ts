import { describe, expect, it } from "vitest";
import { isSessionEvent, type SessionEvent } from "../src/index.js";

describe("isSessionEvent", () => {
  it("accepts a valid user/message", () => {
    const ev: SessionEvent = {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    };
    expect(isSessionEvent(ev)).toBe(true);
    expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
  });

  it("accepts safety/notice", () => {
    const ev: SessionEvent = {
      type: "safety/notice",
      ts: 1,
      turnId: "t1",
      kind: "loop_soft",
      content: "slow down",
      toolName: "echo",
      count: 3,
    };
    expect(isSessionEvent(ev)).toBe(true);
  });

  it("roundtrips prompt/admitted with optional delivery", () => {
    const queued: SessionEvent = {
      type: "prompt/admitted",
      ts: 1,
      admitId: "a1",
      content: "next",
    };
    const steered: SessionEvent = {
      type: "prompt/admitted",
      ts: 2,
      admitId: "a2",
      content: "fix",
      delivery: "steer",
    };
    expect(isSessionEvent(queued)).toBe(true);
    expect(isSessionEvent(steered)).toBe(true);
    expect(JSON.parse(JSON.stringify(queued))).toEqual(queued);
    expect(JSON.parse(JSON.stringify(steered))).toEqual(steered);
  });

  it("parsePromptDelivery accepts omit/queue/steer and rejects junk", async () => {
    const { parsePromptDelivery } = await import("../src/index.js");
    expect(parsePromptDelivery(undefined)).toEqual({
      ok: true,
      delivery: undefined,
    });
    expect(parsePromptDelivery("queue")).toEqual({
      ok: true,
      delivery: "queue",
    });
    expect(parsePromptDelivery("steer")).toEqual({
      ok: true,
      delivery: "steer",
    });
    expect(parsePromptDelivery("asap")).toEqual({ ok: false });
  });

  it("exports sessionEventJsonSchema (and stub alias)", async () => {
    const {
      sessionEventJsonSchema,
      sessionEventJsonSchemaStub,
    } = await import("../src/index.js");
    expect(sessionEventJsonSchema.$id).toContain("session-event");
    expect(sessionEventJsonSchemaStub).toBe(sessionEventJsonSchema);
    expect(sessionEventJsonSchema.oneOf.length).toBeGreaterThan(10);
  });

  it("rejects unknown type", () => {
    expect(isSessionEvent({ type: "nope", ts: 1 })).toBe(false);
  });

  it("rejects missing ts", () => {
    expect(isSessionEvent({ type: "turn/start", turnId: "t" })).toBe(false);
  });
});
