import { describe, expect, it } from "vitest";
import {
  inputPressureTokens,
  promptPressureTokens,
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

  it("window pressure prefers totalTokens; prompt path never adds cacheWrite", () => {
    // Anthropic-shaped: wire input 100 = uncached 60 + cacheRead 40; cacheWrite 20
    // is a billing subset of that prompt, not an additive window layer.
    expect(
      promptPressureTokens({
        inputTokens: 60,
        outputTokens: 5,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
      }),
    ).toBe(100);
    // Codex tokens_in_context_window = total_tokens when present.
    expect(
      inputPressureTokens({
        inputTokens: 60,
        outputTokens: 5,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
        totalTokens: 105,
      }),
    ).toBe(105);
    expect(
      inputPressureTokens({
        inputTokens: 60,
        outputTokens: 5,
        cacheReadTokens: 40,
      }),
    ).toBe(100);
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

  it("tryParseOpenAiUsage maps Responses + Gemini usage shapes", () => {
    expect(
      tryParseOpenAiUsage({
        input_tokens: 110,
        output_tokens: 20,
        total_tokens: 130,
        input_tokens_details: { cached_tokens: 40, cache_write_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 8 },
      }),
    ).toEqual({
      inputTokens: 70,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      reasoningTokens: 8,
      totalTokens: 130,
    });
    expect(
      tryParseOpenAiUsage({
        promptTokenCount: 90,
        candidatesTokenCount: 12,
        totalTokenCount: 102,
        cachedContentTokenCount: 30,
      }),
    ).toEqual({
      inputTokens: 60,
      outputTokens: 12,
      cacheReadTokens: 30,
      totalTokens: 102,
    });
  });
});
