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

  it("sets ephemeral cache_control on system and last tool", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
          },
        }),
        { status: 200 },
      );
    });
    const llm = createAnthropicAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    const out = await llm.chat({
      messages: [
        { role: "system", content: "stable system" },
        { role: "user", content: "hi" },
      ],
      tools: [
        { name: "alpha", description: "a", parameters: { type: "object" } },
        { name: "zeta", description: "z", parameters: { type: "object" } },
      ],
    });
    expect(body?.system).toEqual([
      {
        type: "text",
        text: "stable system",
        cache_control: { type: "ephemeral" },
      },
    ]);
    const tools = body?.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(2);
    expect(tools[0]).not.toHaveProperty("cache_control");
    expect(tools[1]).toMatchObject({
      name: "zeta",
      cache_control: { type: "ephemeral" },
    });
    expect(out.usage).toMatchObject({
      inputTokens: 60,
      outputTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    });
  });

  it("merges stream message_start/delta usage with cache fields", async () => {
    const frames = [
      JSON.stringify({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      }),
      JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 3 },
      }),
    ]
      .map((row) => `data: ${row}\n\n`)
      .join("");
    const llm = createAnthropicAdapter({
      apiKey: "k",
      fetch: (async () =>
        new Response(`${frames}data: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of llm.stream!({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }
    const usages = events.filter((e) => e.type === "usage");
    expect(usages.length).toBeGreaterThanOrEqual(1);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({
      type: "done",
      content: "hi",
      usage: {
        inputTokens: 60,
        outputTokens: 3,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
      },
    });
  });
});
