import { describe, expect, it, vi } from "vitest";
import {
  discoverOpenAiChatModels,
  ModelDiscoveryError,
} from "../src/discover.js";
import { resetModelsDevCatalogCache } from "../src/models-dev-catalog.js";

describe("discoverOpenAiChatModels", () => {
  it("parses GET /models listing and fills name/capacity aliases", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.example/v1/models");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer probe",
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "acme-large",
              name: "Acme Large",
              context_window: 65536,
              max_output_tokens: 4096,
            },
            { id: "acme-small" },
            { id: "acme-large" },
            { display_name: "no-id" },
            {
              id: "acme-nested",
              displayName: "Nested",
              max_input_tokens: 128_000,
              limit: { output: 8192 },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const models = await discoverOpenAiChatModels({
      baseUrl: "https://gateway.example/v1/",
      apiKey: "probe",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(models).toEqual([
      {
        id: "acme-large",
        name: "Acme Large",
        contextWindow: 65536,
        maxTokens: 4096,
      },
      { id: "acme-small", name: "acme-small" },
      {
        id: "acme-nested",
        name: "Nested",
        contextWindow: 128_000,
        maxTokens: 8192,
      },
    ]);
  });

  it("keeps OFM-style reasoning menus from /v1/models", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "beam-free",
              context_window: 131_072,
            },
            {
              id: "codearts/deepseek-v4-flash",
              name: "deepseek-v4-flash",
              context_window: 1_048_576,
              reasoning: {
                efforts: [
                  { id: "on", name: "开启", canonical: "high" },
                  { id: "off", name: "关闭", canonical: "none" },
                ],
                default: "on",
                openai_efforts: ["high", "none"],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const models = await discoverOpenAiChatModels({
      baseUrl: "http://127.0.0.1:18900/v1",
      apiKey: "ofm-test",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(models).toEqual([
      { id: "beam-free", name: "beam-free", contextWindow: 131_072 },
      {
        id: "codearts/deepseek-v4-flash",
        name: "deepseek-v4-flash",
        contextWindow: 1_048_576,
        reasoning: {
          efforts: [
            { id: "on", name: "开启" },
            { id: "off", name: "关闭" },
          ],
          defaultEffort: "on",
        },
      },
    ]);
  });

  it("parses an enriched models object (gateway map)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: {
            "lobechat-deepseek-chat": {
              name: "DeepSeek V4 Flash",
              contextWindow: 1_048_576,
              maxTokens: 384_000,
            },
            "bare-route": {},
            "nested-id": { id: "ignored-when-key-set", name: "Nested fallback" },
            "primitive-route": "not a model record",
          },
        }),
        { status: 200 },
      ),
    );
    const models = await discoverOpenAiChatModels({
      baseUrl: "https://gateway.example/v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(models).toEqual([
      {
        id: "lobechat-deepseek-chat",
        name: "DeepSeek V4 Flash",
        contextWindow: 1_048_576,
        maxTokens: 384_000,
      },
      { id: "bare-route", name: "bare-route" },
      { id: "nested-id", name: "Nested fallback" },
    ]);
  });

  it("uses Anthropic listing path, headers, and capacity fields", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
      expect(init?.headers).toMatchObject({
        "x-api-key": "anthropic-key",
        "anthropic-version": "2023-06-01",
      });
      expect(
        (init?.headers as Record<string, string>).authorization,
      ).toBeUndefined();
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "claude-sonnet",
              display_name: "Claude Sonnet",
              max_input_tokens: 200_000,
              max_tokens: 64_000,
            },
          ],
        }),
        { status: 200 },
      );
    });
    const root = await discoverOpenAiChatModels({
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "anthropic-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const versioned = await discoverOpenAiChatModels({
      baseUrl: "https://api.anthropic.com/v1",
      api: "anthropic-messages",
      apiKey: "anthropic-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(root).toEqual([
      {
        id: "claude-sonnet",
        name: "Claude Sonnet",
        contextWindow: 200_000,
        maxTokens: 64_000,
      },
    ]);
    expect(versioned).toEqual(root);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads Gemini's models array, header auth, and token limits", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
      expect(init?.headers).toMatchObject({ "x-goog-api-key": "google-key" });
      expect(
        (init?.headers as Record<string, string>).authorization,
      ).toBeUndefined();
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-3-pro",
              displayName: "Gemini 3 Pro",
              inputTokenLimit: 1_048_576,
              outputTokenLimit: 65_535,
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            {
              name: "models/text-embedding-004",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const models = await discoverOpenAiChatModels({
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      api: "gemini-generate",
      apiKey: "google-key",
      fetch: fetchMock as unknown as typeof fetch,
      catalogFetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    // The `models/` prefix is Google's resource spelling, not a route name.
    expect(models).toEqual([
      {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        contextWindow: 1_048_576,
        maxTokens: 65_535,
      },
    ]);
  });

  it("maps 401 to a check-the-key message without echoing the key", async () => {
    await expect(
      discoverOpenAiChatModels({
        baseUrl: "https://gateway.example/v1",
        apiKey: "secret-key",
        fetch: (async () =>
          new Response("nope", { status: 401 })) as unknown as typeof fetch,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ModelDiscoveryError);
      expect(String(err)).toContain("answered 401");
      expect(String(err)).toContain("check the API key");
      expect(String(err)).not.toContain("secret-key");
      return true;
    });
  });

  it("rejects non-listable protocols", async () => {
    await expect(
      discoverOpenAiChatModels({
        baseUrl: "https://gateway.example/v1",
        api: "gemini-generate",
      }),
    ).rejects.toBeInstanceOf(ModelDiscoveryError);
  });

  describe("public catalog second opinion", () => {
    const catalog = {
      "opencode-go": {
        api: "https://opencode.ai/inference/go/openai/v1",
        models: {
          "glm-5.3-flash": {
            limit: { context: 1_000_000, output: 131_072 },
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
            modalities: { input: ["text", "image", "pdf"] },
          },
          "toggle-only": {
            limit: { context: 128_000 },
            reasoning_options: [{ type: "toggle" }],
          },
        },
      },
      opencode: {
        api: "https://opencode.ai/inference/openai/v1",
        models: {
          // Listed under Zen only; a Go row still gets its numbers.
          "glm-5.1": { limit: { context: 2_000_000, output: 65_536 } },
        },
      },
    };

    const listing = (rows: readonly unknown[]): typeof fetch =>
      (async () =>
        new Response(JSON.stringify({ object: "list", data: rows }), {
          status: 200,
        })) as unknown as typeof fetch;

    const catalogFetch = (): typeof fetch =>
      (async (url: string) => {
        expect(url).toBe("https://models.dev/api.json");
        return new Response(JSON.stringify(catalog), { status: 200 });
      }) as unknown as typeof fetch;

    it("fills what a bare id listing left blank", async () => {
      resetModelsDevCatalogCache();
      const models = await discoverOpenAiChatModels({
        provider: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go/v1",
        api: "openai-chat",
        fetch: listing([
          { id: "glm-5.3-flash", object: "model", owned_by: "opencode" },
          { id: "glm-5.1", object: "model", owned_by: "opencode" },
          { id: "toggle-only", object: "model" },
          { id: "unknown-model", object: "model" },
        ]),
        catalogFetch: catalogFetch(),
      });
      expect(models).toEqual([
        {
          id: "glm-5.3-flash",
          name: "glm-5.3-flash",
          contextWindow: 1_000_000,
          maxTokens: 131_072,
          inputModalities: ["text", "image"],
          reasoning: {
            efforts: [
              { id: "low", name: "Low" },
              { id: "high", name: "High" },
              { id: "max", name: "Max" },
            ],
            defaultEffort: "high",
          },
        },
        {
          id: "glm-5.1",
          name: "glm-5.1",
          contextWindow: 2_000_000,
          maxTokens: 65_536,
        },
        // A toggle menu is not an effort menu: the harness would send a value
        // the upstream never accepted, so it stays unset and hand-editable.
        { id: "toggle-only", name: "toggle-only", contextWindow: 128_000 },
        { id: "unknown-model", name: "unknown-model" },
      ]);
    });

    it("never overwrites what the endpoint itself disclosed", async () => {
      resetModelsDevCatalogCache();
      const models = await discoverOpenAiChatModels({
        provider: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go/v1",
        fetch: listing([
          {
            id: "glm-5.3-flash",
            context_window: 256_000,
            max_output_tokens: 32_768,
            input_modalities: ["text"],
            reasoning: { efforts: [{ id: "on", name: "开启" }] },
          },
        ]),
        catalogFetch: catalogFetch(),
      });
      expect(models).toEqual([
        {
          id: "glm-5.3-flash",
          name: "glm-5.3-flash",
          contextWindow: 256_000,
          maxTokens: 32_768,
          inputModalities: ["text"],
          reasoning: { efforts: [{ id: "on", name: "开启" }] },
        },
      ]);
    });

    it("answers from the listing when the catalog is unreachable", async () => {
      resetModelsDevCatalogCache();
      const models = await discoverOpenAiChatModels({
        provider: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go/v1",
        fetch: listing([{ id: "beam-free", object: "model" }]),
        catalogFetch: (async () => {
          throw new Error("blocked");
        }) as unknown as typeof fetch,
      });
      expect(models).toEqual([{ id: "beam-free", name: "beam-free" }]);
    });

    it("skips the catalog when the listing answered everything", async () => {
      resetModelsDevCatalogCache();
      const catalogSpy = vi.fn(async () => new Response("{}", { status: 200 }));
      const models = await discoverOpenAiChatModels({
        provider: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go/v1",
        fetch: listing([
          {
            id: "full",
            context_window: 128_000,
            max_output_tokens: 8_192,
            input_modalities: ["text"],
            reasoning: { efforts: [{ id: "high", name: "High" }] },
          },
        ]),
        catalogFetch: catalogSpy as unknown as typeof fetch,
      });
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(models[0]?.contextWindow).toBe(128_000);
    });

    it("follows a brand alias and withholds menus the adapter cannot send", async () => {
      resetModelsDevCatalogCache();
      const aliased = await discoverOpenAiChatModels({
        provider: "fireworks",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        api: "openai-chat",
        fetch: listing([{ id: "accounts/fireworks/models/kimi-k2", object: "model" }]),
        catalogFetch: (async () =>
          new Response(
            JSON.stringify({
              "fireworks-ai": {
                api: "https://api.fireworks.ai/inference/v1",
                models: {
                  "accounts/fireworks/models/kimi-k2": {
                    limit: { context: 262_144, output: 32_768 },
                    reasoning_options: [{ type: "effort", values: ["low", "high"] }],
                  },
                },
              },
            }),
            { status: 200 },
          )) as unknown as typeof fetch,
      });
      expect(aliased[0]).toMatchObject({
        contextWindow: 262_144,
        maxTokens: 32_768,
      });
      expect(aliased[0]?.reasoning?.efforts.map((e) => e.id)).toEqual(["low", "high"]);

      resetModelsDevCatalogCache();
      const anthropic = await discoverOpenAiChatModels({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        fetch: (async () =>
          new Response(JSON.stringify({ data: [{ id: "claude-sonnet" }] }), {
            status: 200,
          })) as unknown as typeof fetch,
        catalogFetch: (async () =>
          new Response(
            JSON.stringify({
              anthropic: {
                api: "https://api.anthropic.com/v1",
                models: {
                  "claude-sonnet": {
                    limit: { context: 200_000, output: 64_000 },
                    reasoning_options: [{ type: "effort", values: ["low", "high"] }],
                  },
                },
              },
            }),
            { status: 200 },
          )) as unknown as typeof fetch,
      });
      // Capacities still come through; the level menu does not, because the
      // Anthropic adapter would not put it on the wire.
      expect(anthropic[0]).toMatchObject({
        contextWindow: 200_000,
        maxTokens: 64_000,
      });
      expect(anthropic[0]?.reasoning).toBeUndefined();
    });
  });
});
