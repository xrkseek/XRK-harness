import { describe, expect, it } from "vitest";
import {
  inputPressureTokens,
  providerUsageSample,
  usageFromSessionEvent,
  type SessionEvent,
} from "../src/index.js";

describe("token-usage event helpers", () => {
  it("reads mid-stream usage chunk and final message", () => {
    const chunk: SessionEvent = {
      type: "assistant/chunk",
      ts: 1,
      turnId: "t",
      stepId: "s",
      text: "",
      kind: "usage",
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 },
    };
    const message: SessionEvent = {
      type: "assistant/message",
      ts: 2,
      turnId: "t",
      stepId: "s",
      content: "ok",
      usage: { inputTokens: 11, outputTokens: 4 },
    };
    expect(usageFromSessionEvent(chunk)).toEqual(chunk.usage);
    expect(providerUsageSample(chunk)).toEqual({
      usage: chunk.usage,
      turnId: "t",
      stepId: "s",
    });
    expect(usageFromSessionEvent(message)).toEqual(message.usage);
    expect(inputPressureTokens(chunk.usage!)).toBe(13);
  });

  it("ignores non-usage events and usage-less messages", () => {
    expect(
      usageFromSessionEvent({
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      }),
    ).toBeUndefined();
    expect(
      providerUsageSample({
        type: "assistant/message",
        ts: 1,
        turnId: "t",
        stepId: "s",
        content: "hi",
      }),
    ).toBeUndefined();
  });
});
