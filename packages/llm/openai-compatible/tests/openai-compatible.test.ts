import { describe, expect, it, vi } from "vitest";
import { ContextOverflowError } from "@xrkseek/llm";
import {
  buildOpenAiCompatibleEndpoint,
  createOpenAiCompatibleAdapter,
} from "../src/index.js";

describe("openai-compatible adapter", () => {
  it("builds endpoint", () => {
    expect(
      buildOpenAiCompatibleEndpoint("https://api.example.com/v1/", "/chat/completions"),
    ).toBe("https://api.example.com/v1/chat/completions");
  });

  it("maps messages/tools and parses tool_calls", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: unknown[];
        tools: unknown[];
      };
      expect(body.model).toBe("gpt-test");
      expect(body.messages).toEqual([
        { role: "user", content: "hi" },
      ]);
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object" },
          },
        },
      ]);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-test",
      });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: '{"x":1}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "echo",
          description: "echo",
          parameters: { type: "object" },
        },
      ],
    });
    expect(out.toolCalls).toEqual([
      { id: "c1", name: "echo", arguments: { x: 1 } },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws ContextOverflowError on context length errors", async () => {
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: { message: "This model's maximum context length is 8k" },
          }),
          { status: 400 },
        )) as unknown as typeof fetch,
    });
    await expect(
      llm.chat({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
  });

  it("supports api-key auth mode", async () => {
    let saw = "";
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://gw.example/v1",
      apiKey: "k",
      model: "m",
      authMode: "api-key",
      fetch: (async (_u, init) => {
        const h = init?.headers as Record<string, string>;
        saw = h["api-key"] ?? "";
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("ok");
    expect(saw).toBe("k");
  });
});
