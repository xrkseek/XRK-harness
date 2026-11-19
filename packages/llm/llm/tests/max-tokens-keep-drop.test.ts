import { describe, expect, it } from "vitest";
import { applyMaxTokensKeepDrop, finalizeLlmChatResponse } from "../src/index.js";

describe("applyMaxTokensKeepDrop", () => {
  it("strips tool calls and records dropped names", () => {
    const out = applyMaxTokensKeepDrop({
      content: "partial",
      finishReason: "max-tokens",
      toolCalls: [
        { id: "1", name: "write_file", arguments: { path: "a" } },
        { id: "2", name: "write_file", arguments: { path: "b" } },
        { id: "3", name: "apply_patch", arguments: { patch: "…" } },
      ],
    });
    expect(out.toolCalls).toBeUndefined();
    expect(out.droppedToolNames).toEqual(["write_file", "apply_patch"]);
    expect(out.finishReason).toBe("max-tokens");
  });

  it("leaves non-max-tokens responses alone", () => {
    const input = {
      content: "ok",
      finishReason: "tool-calls" as const,
      toolCalls: [{ id: "1", name: "echo", arguments: {} }],
    };
    expect(applyMaxTokensKeepDrop(input)).toBe(input);
  });
});

describe("finalizeLlmChatResponse max-tokens", () => {
  it("surfaces droppedToolNames after keep/drop", () => {
    const out = finalizeLlmChatResponse({
      content: "mid",
      finishReason: "max-tokens",
      toolCalls: [{ id: "1", name: "write_file", arguments: { _raw: "{" } }],
    });
    expect(out.toolCalls).toBeUndefined();
    expect(out.droppedToolNames).toEqual(["write_file"]);
  });
});
