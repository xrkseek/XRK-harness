import { describe, expect, it } from "vitest";
import {
  containsChannelLeak,
  finalizeLlmChatResponse,
  scrubChannelLeakText,
} from "../src/index.js";

describe("channel-leak scrub", () => {
  it("detects Harmony / rfl markers", () => {
    expect(containsChannelLeak("<|channel|>analysis")).toBe(true);
    expect(
      containsChannelLeak("</rfl:parameter><|end|><|start|>asset"),
    ).toBe(true);
    expect(containsChannelLeak("normal path/to/file.py")).toBe(false);
  });

  it("scrubs markers in tool args before persist", () => {
    const out = finalizeLlmChatResponse({
      content: "",
      finishReason: "tool-calls",
      toolCalls: [
        {
          id: "c1",
          name: "write_file",
          arguments: {
            path: "</rfl:parameter><|end|><|start|>asset<|channel|>analysis<|message|>Now update",
            content: "print(1)\n",
          },
        },
      ],
    });
    const args = out.toolCalls?.[0]?.arguments as {
      path: string;
      content: string;
    };
    expect(args.path).not.toMatch(/<\|channel\|>/);
    expect(args.path).toContain("[channel-leak-removed]");
    expect(args.content).toBe("print(1)\n");
  });

  it("scrubs markers in assistant content", () => {
    expect(scrubChannelLeakText("hi <|message|>x")).toBe(
      "hi [channel-leak-removed]x",
    );
    const out = finalizeLlmChatResponse({
      content: "done <|end|>",
      finishReason: "stop",
    });
    expect(out.content).toBe("done [channel-leak-removed]");
  });
});
