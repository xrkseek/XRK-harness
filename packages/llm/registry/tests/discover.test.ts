import { describe, expect, it, vi } from "vitest";
import {
  discoverOpenAiChatModels,
  ModelDiscoveryError,
} from "../src/discover.js";

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
});
