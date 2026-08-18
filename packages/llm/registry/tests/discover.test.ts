import { describe, expect, it, vi } from "vitest";
import {
  discoverOpenAiChatModels,
  ModelDiscoveryError,
} from "../src/discover.js";

describe("discoverOpenAiChatModels", () => {
  it("parses GET /models listing", async () => {
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
      { id: "acme-small" },
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
        api: "anthropic-messages",
      }),
    ).rejects.toBeInstanceOf(ModelDiscoveryError);
  });
});
