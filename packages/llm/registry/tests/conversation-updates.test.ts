import { describe, expect, it } from "vitest";
import { conversationUpdates } from "../src/conversation-updates.js";

describe("conversationUpdates", () => {
  it("defaults mid-convo Chat Completions / Anthropic / Responses to in-history", () => {
    for (const protocol of [
      "openai-chat",
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
    ] as const) {
      expect(conversationUpdates({ protocol })).toEqual({
        systemPromptUpdate: "in-history",
      });
    }
  });

  it("does not invent mid-convo system for Gemini", () => {
    expect(conversationUpdates({ protocol: "gemini-generate" })).toEqual({});
  });

  it("honours explicit catalog withhold (DeepSeek Pro style)", () => {
    expect(
      conversationUpdates({
        protocol: "openai-chat",
        systemPromptUpdate: false,
      }),
    ).toEqual({});
  });

  it("honours explicit in-history override on Gemini", () => {
    expect(
      conversationUpdates({
        protocol: "gemini-generate",
        systemPromptUpdate: "in-history",
      }),
    ).toEqual({ systemPromptUpdate: "in-history" });
  });

  it("honours compat.supportsMidConvoSystemMessages like DSH pi-ai", () => {
    expect(
      conversationUpdates({
        protocol: "gemini-generate",
        compat: { supportsMidConvoSystemMessages: true },
      }),
    ).toEqual({ systemPromptUpdate: "in-history" });
    expect(
      conversationUpdates({
        protocol: "openai-chat",
        compat: { supportsMidConvoSystemMessages: false },
      }),
    ).toEqual({});
  });

  it("applies toolUpdate only on anthropic-messages (capability gate)", () => {
    expect(
      conversationUpdates({
        protocol: "anthropic-messages",
        toolUpdate: "addition-only",
      }),
    ).toEqual({
      systemPromptUpdate: "in-history",
      toolUpdate: "addition-only",
    });
    // Chat Completions cannot carry defer_loading / tool_addition — drop it.
    expect(
      conversationUpdates({
        protocol: "openai-chat",
        toolUpdate: "addition-only",
      }),
    ).toEqual({ systemPromptUpdate: "in-history" });
    expect(
      conversationUpdates({
        protocol: "anthropic-messages",
        toolUpdate: false,
      }),
    ).toEqual({ systemPromptUpdate: "in-history" });
  });
});
