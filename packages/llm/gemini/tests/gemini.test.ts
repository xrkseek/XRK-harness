import { describe, expect, it, vi } from "vitest";
import { failureFromUnknown, isRetryableFailure } from "@xrkseek/llm";
import { createGeminiAdapter } from "../src/index.js";

describe("gemini adapter", () => {
  it("posts generateContent with key query param", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/models/gemini-test:generateContent");
      expect(url).toContain("key=gk");
      const body = JSON.parse(String(init?.body)) as {
        contents: { role: string; parts: { text: string }[] }[];
      };
      expect(body.contents[0]?.role).toBe("user");
      expect(body.contents[0]?.parts[0]?.text).toBe("hi");
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "yo" }] } },
          ],
        }),
        { status: 200 },
      );
    });

    const llm = createGeminiAdapter({
      apiKey: "gk",
      model: "gemini-test",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("yo");
  });

  it("turns a silent body into a retryable TIMEOUT, not a hang", async () => {
    const llm = createGeminiAdapter({
      apiKey: "gk",
      idleTimeoutMs: 25,
      fetch: (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  '{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n',
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
      message: "gemini: idle timeout waiting for stream",
    });
    expect(isRetryableFailure(failureFromUnknown(err))).toBe(true);
  });
});
