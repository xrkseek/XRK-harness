import { describe, expect, it } from "vitest";
import {
  inputPressureTokens,
  providerUsageSample,
  tryParseOpenAiUsage,
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

  it("tryParseOpenAiUsage maps DeepSeek cache hits to disjoint buckets", () => {
    expect(
      tryParseOpenAiUsage({
        prompt_tokens: 283,
        completion_tokens: 69,
        prompt_cache_hit_tokens: 256,
        prompt_cache_miss_tokens: 27,
        prompt_tokens_details: { cached_tokens: 256 },
        completion_tokens_details: { reasoning_tokens: 24 },
      }),
    ).toEqual({
      inputTokens: 27,
      outputTokens: 69,
      cacheReadTokens: 256,
      reasoningTokens: 24,
      totalTokens: 352,
    });
    expect(
      tryParseOpenAiUsage({
        prompt_tokens: 10,
        completion_tokens: 2,
        prompt_cache_hit_tokens: 8,
      }),
    ).toEqual({
      inputTokens: 2,
      outputTokens: 2,
      cacheReadTokens: 8,
      totalTokens: 12,
    });
    expect(
      tryParseOpenAiUsage({ prompt_tokens: 10, completion_tokens: 2 }),
    ).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  });
});
