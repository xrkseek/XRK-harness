import { describe, expect, it, vi } from "vitest";
import { ContextOverflowError, UnsupportedContentError } from "@xrkseek/llm";
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

  it("throws UnsupportedContentError on HTTP 413 request body limits", async () => {
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: { message: "Request entity too large: image payload" },
          }),
          { status: 413 },
        )) as unknown as typeof fetch,
    });
    await expect(
      llm.chat({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toBeInstanceOf(UnsupportedContentError);
  });

  it("keeps 413 context overflow as ContextOverflowError", async () => {
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: { message: "prompt is too long for context length" },
          }),
          { status: 413 },
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

  it("parses optional reasoning_content", async () => {
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "answer",
                  reasoning_content: "step by step",
                },
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("answer");
    expect(out.reasoning).toBe("step by step");
  });

  it("parses chat completion usage", async () => {
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 11, completion_tokens: 3 },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
  });

  it("streams usage on done and requests stream_options.include_usage", async () => {
    let body: Record<string, unknown> | undefined;
    const payload = [
      JSON.stringify({ choices: [{ delta: { content: "a" } }] }),
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    ]
      .map((row) => `data: ${row}\n\n`)
      .join("");
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async (_u, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(`${payload}data: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of llm.stream!({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }
    expect(body?.stream_options).toEqual({ include_usage: true });
    expect(events.some((e) => e.type === "usage")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({
      type: "done",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
  });

  it("streams reasoning-delta then text-delta then done", async () => {
    const payload = [
      JSON.stringify({
        choices: [{ delta: { reasoning_content: "th" } }],
      }),
      JSON.stringify({
        choices: [{ delta: { reasoning_content: "ink" } }],
      }),
      JSON.stringify({
        choices: [{ delta: { content: "ans" } }],
      }),
    ]
      .map((row) => `data: ${row}\n\n`)
      .join("");
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      fetch: (async () =>
        new Response(`${payload}data: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof fetch,
    });
    expect(llm.stream).toBeTypeOf("function");
    const events: { type: string; index?: number; text?: string }[] = [];
    for await (const ev of llm.stream!({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }
    const reasoning = events.filter((e) => e.type === "reasoning-delta");
    expect(reasoning.length).toBeGreaterThanOrEqual(2);
    expect(reasoning[0]).toMatchObject({ index: 0, text: "th" });
    expect(reasoning[1]).toMatchObject({ index: 0, text: "ink" });
    expect(events.some((e) => e.type === "text-delta" && e.index === 1)).toBe(
      true,
    );
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      content: "ans",
      reasoning: "think",
    });
  });

  it("sends image_url data URLs when image modality is enabled", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    let body: {
      messages: { role: string; content: unknown }[];
    } | undefined;
    const llm = createOpenAiCompatibleAdapter({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      inputModalities: ["text", "image"],
      fetch: (async (_u, init) => {
        body = JSON.parse(String(init?.body)) as typeof body;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    const out = await llm.chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            {
              type: "image",
              attachment: {
                attachmentId: "sha256:x",
                mediaType: "image/png",
                bytes: png.byteLength,
                width: 1,
                height: 1,
              },
            },
          ],
        },
      ],
      resolveImage: async () => ({ mediaType: "image/png", data: png }),
    });
    expect(out.content).toBe("ok");
    const content = body?.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "see" },
        {
          type: "image_url",
          image_url: {
            url: expect.stringMatching(/^data:image\/png;base64,/),
          },
        },
      ]),
    );
  });
});
