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

  it("resolves OpenCode Zen and Go gateways", () => {
    const reg = createProviderRegistry();
    const zen = reg.resolve({ provider: "opencode" });
    expect(zen.baseUrl).toBe("https://opencode.ai/zen/v1");
    expect(zen.apiKeyEnv).toBe("OPENCODE_API_KEY");
    expect(zen.model).toBe("big-pickle");
    expect(zen.factoryKind).toBe("compat");
    const go = reg.resolve({ provider: "opencode-go", model: "glm-5" });
    expect(go.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(go.apiKeyEnv).toBe("OPENCODE_GO_API_KEY");
    expect(go.model).toBe("glm-5");
  });

  it("sends x-opencode-session on OpenCode Go and Zen chat", async () => {
    const reg = createProviderRegistry();
    for (const row of [
      {
        provider: "opencode-go" as const,
        model: "deepseek-v4.1-flash",
        sessionId: "sess-go-1",
      },
      {
        provider: "opencode" as const,
        model: "beam-free",
        sessionId: "sess-zen-1",
      },
    ]) {
      const binding = reg.resolve({
        provider: row.provider,
        model: row.model,
      });
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hi" } }],
          }),
          { status: 200 },
        ),
      );
      const adapter = reg.createAdapter(
        binding,
        { apiKey: "oc_sk_test" },
        {
          fetch: fetchMock as unknown as typeof fetch,
          sessionId: row.sessionId,
        },
      );
      await adapter.chat({
        messages: [{ role: "user", content: "ping" }],
      });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["x-opencode-session"]).toBe(row.sessionId);
      expect(headers["x-session-id"]).toBe(row.sessionId);
      expect(headers.authorization).toBe("Bearer oc_sk_test");
      expect(headers["user-agent"]).toMatch(/^xrk-harness\//);
      // openai-chat protocol default (not an OpenCode-only hardcode)
      expect(adapter.systemPromptUpdate).toBe("in-history");
    }
  });

  it("applies conversationUpdates to openai / anthropic / custom; not gemini", () => {
    const reg = createProviderRegistry();
    expect(
      reg.createAdapter(reg.resolve({ provider: "openai", model: "gpt-4o-mini" }), {})
        .systemPromptUpdate,
    ).toBe("in-history");
    expect(
      reg.createAdapter(
        reg.resolve({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
        {},
      ).systemPromptUpdate,
    ).toBe("in-history");
    expect(
      reg.createAdapter(
        reg.resolve({ provider: "gemini", model: "gemini-2.0-flash" }),
        {},
      ).systemPromptUpdate,
    ).toBeUndefined();
    expect(
      reg.createAdapter(
        reg.resolve({ provider: "openai", model: "m" }),
        {},
        { systemPromptUpdate: false },
      ).systemPromptUpdate,
    ).toBeUndefined();
  });

  it("sends x-opencode-session on Go inference Custom bases (Go docs)", async () => {
    const reg = createProviderRegistry();
    const sessionId = "sess-go-inference";
    const binding = reg.resolve({
      provider: "custom",
      protocol: "anthropic-messages",
      baseUrl: "https://opencode.ai/inference/go/anthropic",
      model: "claude-sonnet-4",
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi" }],
        }),
        { status: 200 },
      ),
    );
    const adapter = reg.createAdapter(
      binding,
      { apiKey: "oc_sk_test" },
      {
        fetch: fetchMock as unknown as typeof fetch,
        sessionId,
      },
    );
    expect(adapter.systemPromptUpdate).toBe("in-history");
    await adapter.chat({
      messages: [{ role: "user", content: "ping" }],
    });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-opencode-session"]).toBe(sessionId);
    expect(headers["user-agent"]).toMatch(/^xrk-harness\//);
  });

  it("sunflower-free sidecar brand: in-history + x-session-id (not x-opencode-session)", async () => {
    // Plugin registers localhost Bun sidecar — generic affinity, not OpenCode brand.
    // Sidecar remaps Host x-session-id → minted upstream x-opencode-session.
    const reg = createProviderRegistry();
    reg.registerBrand({
      id: "sunflower-free",
      displayName: "向日葵免费",
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:9",
      path: "/chat/completions",
      authMode: "bearer",
      defaultModel: "big-pickle",
    });
    const binding = reg.resolve({
      provider: "sunflower-free",
      model: "big-pickle",
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hi" } }],
        }),
        { status: 200 },
      ),
    );
    const adapter = reg.createAdapter(
      binding,
      { apiKey: "sidecar-key" },
      {
        fetch: fetchMock as unknown as typeof fetch,
        sessionId: "sess-sunflower",
      },
    );
    expect(adapter.systemPromptUpdate).toBe("in-history");
    expect(adapter.toolUpdate).toBeUndefined();
    await adapter.chat({
      messages: [{ role: "user", content: "ping" }],
    });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-session-id"]).toBe("sess-sunflower");
    expect(headers["x-opencode-session"]).toBeUndefined();
  });

  it("attaches x-session-id on official DeepSeek without overriding Pro withhold", async () => {
    const reg = createProviderRegistry();
    const flash = reg.resolve({
      provider: "deepseek",
      model: "deepseek-flash",
    });
    const flashFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hi" } }],
        }),
        { status: 200 },
      ),
    );
    const flashAdapter = reg.createAdapter(
      flash,
      { apiKey: "sk" },
      { fetch: flashFetch as unknown as typeof fetch, sessionId: "sess-ds" },
    );
    expect(flashAdapter.systemPromptUpdate).toBe("in-history");
    await flashAdapter.chat({
      messages: [{ role: "user", content: "ping" }],
    });
    const flashHeaders = (
      flashFetch.mock.calls[0]![1] as RequestInit
    ).headers as Record<string, string>;
    expect(flashHeaders["x-session-id"]).toBe("sess-ds");
    expect(flashHeaders["x-opencode-session"]).toBeUndefined();

    const pro = reg.resolve({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    const proAdapter = reg.createAdapter(pro, { apiKey: "sk" });
    expect(proAdapter.systemPromptUpdate).toBeUndefined();
  });

  it("sends x-session-id (not x-opencode-session) on openai / custom / commandcode", async () => {
    const reg = createProviderRegistry();
    for (const row of [
      {
        resolve: { provider: "openai" as const, model: "gpt-4o-mini" },
        sessionId: "sess-openai",
      },
      {
        resolve: {
          provider: "custom" as const,
          baseUrl: "https://relay.example/v1",
          model: "m",
        },
        sessionId: "sess-custom",
      },
      {
        resolve: {
          provider: "commandcode" as const,
          model: "deepseek/deepseek-v4-flash",
        },
        sessionId: "sess-cmd",
      },
      {
        resolve: {
          provider: "custom" as const,
          baseUrl: "https://api.commandcode.ai/provider/v1",
          model: "deepseek/deepseek-v4-flash",
        },
        sessionId: "sess-cmd-custom",
      },
    ]) {
      const binding = reg.resolve(row.resolve);
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hi" } }],
          }),
          { status: 200 },
        ),
      );
      const adapter = reg.createAdapter(
        binding,
        { apiKey: "sk-test" },
        {
          fetch: fetchMock as unknown as typeof fetch,
          sessionId: row.sessionId,
        },
      );
      expect(adapter.systemPromptUpdate).toBe("in-history");
      await adapter.chat({
        messages: [{ role: "user", content: "ping" }],
      });
      const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["x-opencode-session"]).toBeUndefined();
      expect(headers["x-session-id"]).toBe(row.sessionId);
      expect(headers["user-agent"]).toMatch(/^xrk-harness\//);
    }
  });

  it("sets Responses prompt_cache_key for openai and commandcode (not OpenCode-only)", async () => {
    const reg = createProviderRegistry();
    for (const row of [
      {
        resolve: {
          provider: "openai-responses" as const,
          model: "gpt-4o",
        },
        sessionId: "sess-resp-oai",
      },
      {
        resolve: {
          provider: "custom" as const,
          protocol: "openai-responses" as const,
          baseUrl: "https://api.commandcode.ai/provider/v1",
          model: "deepseek/deepseek-v4-flash",
        },
        sessionId: "sess-resp-cmd",
      },
    ]) {
      const binding = reg.resolve(row.resolve);
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "hi" }],
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const adapter = reg.createAdapter(
        binding,
        { apiKey: "sk-test" },
        {
          fetch: fetchMock as unknown as typeof fetch,
          sessionId: row.sessionId,
        },
      );
      await adapter.chat({
        messages: [{ role: "user", content: "ping" }],
      });
      const body = JSON.parse(
        String((fetchMock.mock.calls[0]![1] as RequestInit).body),
      ) as { prompt_cache_key?: string };
      expect(body.prompt_cache_key).toBe(row.sessionId);
      const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["x-session-id"]).toBe(row.sessionId);
      expect(headers["x-opencode-session"]).toBeUndefined();
    }
  });

  it("uses defaultProvider and brand defaultModel", () => {
    const reg = createProviderRegistry({ defaultProvider: "deepseek" });
    const b = reg.resolve({});
    expect(b.provider).toBe("deepseek");
    expect(b.model).toBe("deepseek-flash");
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

  it("openai and deepseek-flash declare image; v4-pro stays text-only; vision-exp declares image", () => {
    const reg = createProviderRegistry();
    const openai = reg.createAdapter(
      reg.resolve({ provider: "openai", model: "m" }),
      {},
    );
    const deepseek = reg.createAdapter(
      reg.resolve({ provider: "deepseek" }),
      {},
    );
    const v4Pro = reg.createAdapter(
      reg.resolve({ provider: "deepseek", model: "deepseek-v4-pro" }),
      {},
    );
    const vision = reg.createAdapter(
      reg.resolve({
        provider: "deepseek",
        model: "deepseek-v4-flash-vision-exp",
      }),
      {},
    );
    expect(openai.inputModalities).toEqual(["text", "image"]);
    expect(deepseek.inputModalities).toEqual(["text", "image"]);
    expect(deepseek.systemPromptUpdate).toBe("in-history");
    expect(v4Pro.inputModalities).toEqual(["text"]);
    expect(v4Pro.systemPromptUpdate).toBeUndefined();
    // Retired Flash aliases are served by the vision-capable Flash backend.
    expect(
      reg.createAdapter(
        reg.resolve({ provider: "deepseek", model: "deepseek-v4-flash" }),
        {},
      ).inputModalities,
    ).toEqual(["text", "image"]);
    expect(vision.inputModalities).toEqual(["text", "image"]);
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

  it("resolves R1 protocols: anthropic · deepseek-messages · gemini · responses", () => {
    const reg = createProviderRegistry();
    const anth = reg.resolve({ provider: "anthropic" });
    expect(anth.protocol).toBe("anthropic-messages");
    expect(anth.factoryKind).toBe("anthropic");
    expect(anth.path).toBe("/v1/messages");

    const dsMsg = reg.resolve({ provider: "deepseek-messages" });
    expect(dsMsg.protocol).toBe("anthropic-messages");
    expect(dsMsg.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(dsMsg.factoryKind).toBe("anthropic");
    const dsAdapter = reg.createAdapter(dsMsg, { apiKey: "k" });
    expect(dsAdapter.toolUpdate).toBe("addition-only");
    expect(dsAdapter.systemPromptUpdate).toBe("in-history");

    const gem = reg.resolve({ provider: "gemini" });
    expect(gem.protocol).toBe("gemini-generate");
    expect(gem.factoryKind).toBe("gemini");

    const resp = reg.resolve({ provider: "openai-responses" });
    expect(resp.protocol).toBe("openai-responses");
    expect(resp.factoryKind).toBe("responses");
  });

  it("protocol override maps custom brand onto anthropic-messages", async () => {
    const reg = createProviderRegistry();
    const binding = reg.resolve({
      provider: "custom",
      baseUrl: "https://gw.example",
      protocol: "anthropic-messages",
      model: "claude-x",
    });
    expect(binding.protocol).toBe("anthropic-messages");
    expect(binding.factoryKind).toBe("anthropic");

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "via-override" }] }),
        { status: 200 },
      ),
    );
    const adapter = reg.createAdapter(
      binding,
      { apiKey: "k" },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const out = await adapter.chat({
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.content).toBe("via-override");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/messages");
  });

  it("openai-completions aliases chat completions factory", () => {
    const reg = createProviderRegistry();
    const b = reg.resolve({
      provider: "openai",
      protocol: "openai-completions",
    });
    expect(b.protocol).toBe("openai-completions");
    expect(b.factoryKind).toBe("compat");
  });
});
