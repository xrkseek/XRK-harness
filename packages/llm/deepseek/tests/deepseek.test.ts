import { describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  createDeepSeekAdapter,
} from "../src/index.js";

describe("deepseek adapter", () => {
  it("defaults baseUrl and model; bearer auth", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe(DEEPSEEK_DEFAULT_MODEL);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-ds",
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
        }),
        { status: 200 },
      );
    });

    const llm = createDeepSeekAdapter({
      apiKey: "sk-ds",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(llm.id).toBe("deepseek");
    expect(llm.inputModalities).toEqual(["text"]);
    expect(llm.stream).toBeTypeOf("function");

    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows baseUrl and model override", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe("deepseek-v4-flash");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "gw" } }],
        }),
        { status: 200 },
      );
    });

    const llm = createDeepSeekAdapter({
      id: "ds-gw",
      baseUrl: "https://gateway.example/v1",
      model: "deepseek-v4-flash",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(llm.id).toBe("ds-gw");
    const out = await llm.chat({
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.content).toBe("gw");
  });
});
