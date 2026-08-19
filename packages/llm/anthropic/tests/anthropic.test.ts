import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicAdapter,
} from "../src/index.js";

describe("anthropic adapter", () => {
  it("posts Messages API with x-api-key", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`);
      expect(init?.headers).toMatchObject({
        "x-api-key": "sk-ant",
        "anthropic-version": "2023-06-01",
      });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: unknown[];
      };
      expect(body.model).toBe("claude-test");
      expect(body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ]);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello" }],
        }),
        { status: 200 },
      );
    });

    const llm = createAnthropicAdapter({
      apiKey: "sk-ant",
      model: "claude-test",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    expect(llm.inputModalities).toEqual(["text", "image"]);
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("hello");
  });

  it("parses tool_use blocks", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "calling" },
            {
              type: "tool_use",
              id: "tu1",
              name: "grep",
              input: { q: "x" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const llm = createAnthropicAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "go" }],
    });
    expect(out.content).toBe("calling");
    expect(out.toolCalls).toEqual([
      { id: "tu1", name: "grep", arguments: { q: "x" } },
    ]);
  });
});
