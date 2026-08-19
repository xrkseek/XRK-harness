import { describe, expect, it, vi } from "vitest";
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
});
