import { describe, expect, it, vi } from "vitest";
import { failureFromUnknown, isRetryableFailure } from "@xrkseek/llm";
import { createOpenAiResponsesAdapter } from "../src/index.js";

describe("openai-responses adapter", () => {
  it("posts /responses and parses output message", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk",
      });
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe("gpt-test");
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
        }),
        { status: 200 },
      );
    });

    const llm = createOpenAiResponsesAdapter({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk",
      model: "gpt-test",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("ok");
  });

  it("turns a silent body into a retryable TIMEOUT, not a hang", async () => {
    const llm = createOpenAiResponsesAdapter({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk",
      idleTimeoutMs: 25,
      fetch: (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
                ),
              );
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        )) as unknown as typeof fetch,
    });
    const err = await (async () => {
      for await (const _ of llm.stream!({
        messages: [{ role: "user", content: "hi" }],
      })) {
        /* drain */
      }
    })().catch((e: unknown) => e);
    expect(err).toMatchObject({
      name: "LlmError",
      code: "TIMEOUT",
      message: "openai-responses: idle timeout waiting for stream",
    });
    expect(isRetryableFailure(failureFromUnknown(err))).toBe(true);
  });
});
