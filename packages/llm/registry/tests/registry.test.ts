import { describe, expect, it, vi } from "vitest";
import {
  REGISTRY_FALLBACK_MODEL,
  createProviderRegistry,
} from "../src/registry.js";

describe("createProviderRegistry", () => {
  it("resolves openrouter with model override", () => {
    const reg = createProviderRegistry();
    const b = reg.resolve({ provider: "openrouter", model: "x" });
    expect(b.provider).toBe("openrouter");
    expect(b.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(b.model).toBe("x");
    expect(b.path).toBe("/chat/completions");
    expect(b.authMode).toBe("bearer");
    expect(b.factoryKind).toBe("compat");
  });

  it("uses defaultProvider and brand defaultModel", () => {
    const reg = createProviderRegistry({ defaultProvider: "deepseek" });
    const b = reg.resolve({});
    expect(b.provider).toBe("deepseek");
    expect(b.model).toBe("deepseek-chat");
  });

  it("throws on unknown provider", () => {
    const reg = createProviderRegistry();
    expect(() => reg.resolve({ provider: "nope" })).toThrow(/unknown provider/i);
  });

  it("requires baseUrl for custom", () => {
    const reg = createProviderRegistry();
    expect(() => reg.resolve({ provider: "custom" })).toThrow(/baseUrl required/i);
    const b = reg.resolve({
      provider: "custom",
      baseUrl: "https://gw.example/v1",
    });
    expect(b.baseUrl).toBe("https://gw.example/v1");
    expect(b.model).toBe(REGISTRY_FALLBACK_MODEL);
  });

  it("skips default/auto aliases without a real provider", () => {
    const reg = createProviderRegistry();
    expect(() => reg.resolve({ provider: "default" })).toThrow(/no provider resolved/i);
  });

  it("createAdapter chats via mock fetch", async () => {
    const reg = createProviderRegistry();
    const binding = reg.resolve({
      provider: "openai",
      model: "gpt-test",
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
        }),
        { status: 200 },
      ),
    );
    const adapter = reg.createAdapter(
      binding,
      { apiKey: "sk-test" },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(adapter.id).toBe("openai");
    const res = await adapter.chat({
      messages: [{ role: "user", content: "ping" }],
    });
    expect(res.content).toBe("hi");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("openai adapter declares image; deepseek stays text-only", () => {
    const reg = createProviderRegistry();
    const openai = reg.createAdapter(
      reg.resolve({ provider: "openai", model: "m" }),
      {},
    );
    const deepseek = reg.createAdapter(
      reg.resolve({ provider: "deepseek" }),
      {},
    );
    expect(openai.inputModalities).toEqual(["text", "image"]);
    expect(deepseek.inputModalities).toEqual(["text"]);
  });

  it("listRoutable marks active when key present", () => {
    const reg = createProviderRegistry();
    const rows = reg.listRoutable({
      OPENAI_API_KEY: "sk",
      GROQ_API_KEY: "",
    });
    const openai = rows.find((r) => r.id === "openai");
    const groq = rows.find((r) => r.id === "groq");
    const ollama = rows.find((r) => r.id === "ollama");
    expect(openai?.active).toBe(true);
    expect(groq?.active).toBe(false);
    expect(ollama?.active).toBe(true);
  });
});
