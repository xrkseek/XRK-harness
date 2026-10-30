import { describe, expect, it } from "vitest";
import {
  createBraveSearch,
  createCascadingSearch,
  createDeepSeekSearch,
  createSearchFromEnv,
  createTavilySearch,
  resolveSearchProviderId,
  searchUnavailableMessage,
} from "../src/search-providers.js";

describe("search provider selection", () => {
  it("prefers Tavily when both keys exist unless pinned; else parallel-free", () => {
    expect(
      resolveSearchProviderId({
        XRK_TAVILY_API_KEY: "t",
        XRK_BRAVE_SEARCH_API_KEY: "b",
      }),
    ).toBe("tavily");
    expect(
      resolveSearchProviderId({
        XRK_TAVILY_API_KEY: "t",
        XRK_BRAVE_SEARCH_API_KEY: "b",
        XRK_WEB_SEARCH_PROVIDER: "brave",
      }),
    ).toBe("brave");
    expect(resolveSearchProviderId({})).toBe("parallel-free");
    expect(
      resolveSearchProviderId({ XRK_WEB_SEARCH_PROVIDER: "duckduckgo" }),
    ).toBe("duckduckgo");
    expect(
      resolveSearchProviderId({ XRK_WEB_SEARCH_PROVIDER: "parallel-free" }),
    ).toBe("parallel-free");
    expect(
      resolveSearchProviderId({ DEEPSEEK_API_KEY: "sk-ds" }),
    ).toBe("parallel-free");
    expect(
      resolveSearchProviderId({
        XRK_WEB_SEARCH_PROVIDER: "deepseek",
        XRK_DEEPSEEK_SEARCH_API_KEY: "sk-ds",
      }),
    ).toBe("deepseek");
    expect(
      resolveSearchProviderId({
        XRK_WEB_SEARCH_PROVIDER: "auto",
        DEEPSEEK_API_KEY: "sk-ds",
      }),
    ).toBe("parallel-free");
    expect(
      searchUnavailableMessage({ XRK_WEB_SEARCH_PROVIDER: "exa" }),
    ).toMatch(/Unknown web search provider/);
    expect(
      searchUnavailableMessage({ XRK_WEB_SEARCH_PROVIDER: "deepseek" }),
    ).toMatch(/DeepSeek/);
  });
});

describe("Tavily / Brave HTTP", () => {
  it("maps Tavily answer + results", async () => {
    const search = createTavilySearch({
      apiKey: "secret",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.api_key).toBe("secret");
        expect(body.query).toBe("cats");
        return Response.json({
          answer: "cats are animals",
          results: [
            {
              url: "https://example.com/cats",
              title: "Cats",
              content: "meow",
              published_date: "2026-01-01",
            },
          ],
        });
      },
    });
    const out = await search.search({ query: "cats", maxResults: 8 });
    expect(out.content).toBe("cats are animals");
    expect(out.sources).toEqual([
      {
        url: "https://example.com/cats",
        title: "Cats",
        snippet: "meow",
        publishedAt: "2026-01-01",
      },
    ]);
  });

  it("maps Brave web.results and caps over-return", async () => {
    const search = createBraveSearch({
      apiKey: "token",
      fetch: async (input, init) => {
        expect(String(input)).toContain("q=dogs");
        expect(new Headers(init?.headers).get("x-subscription-token")).toBe(
          "token",
        );
        return Response.json({
          web: {
            results: [
              { url: "https://a.example/", title: "A", description: "one" },
              { url: "https://b.example/", title: "B", description: "two" },
              { url: "https://c.example/", title: "C" },
            ],
          },
        });
      },
    });
    const out = await search.search({ query: "dogs", maxResults: 2 });
    expect(out.truncated).toBe(true);
    expect(out.sources).toHaveLength(2);
  });

  it("createSearchFromEnv defaults to cascading parallel-free → duckduckgo", async () => {
    const calls: string[] = [];
    const search = createSearchFromEnv({
      env: {},
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("parallel.ai")) {
          throw new Error("parallel down");
        }
        return new Response(
          `<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F">Example</a>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      },
    });
    expect(search).toBeDefined();
    const out = await search!.search({ query: "q", maxResults: 8 });
    expect(out.sources[0]?.url).toBe("https://example.com/");
    expect(calls.some((u) => u.includes("parallel.ai") || u.includes("duckduckgo"))).toBe(
      true,
    );
  });

  it("createCascadingSearch falls through empty primary", async () => {
    const search = createCascadingSearch(
      {
        async search() {
          return { sources: [], truncated: false };
        },
      },
      [
        {
          async search() {
            return {
              sources: [{ url: "https://fb.example/", title: "FB" }],
              truncated: false,
            };
          },
        },
      ],
    );
    const out = await search.search({ query: "q", maxResults: 3 });
    expect(out.sources[0]?.url).toBe("https://fb.example/");
  });

  it("times out via the provider budget, not a second timer", async () => {
    const search = createTavilySearch({
      apiKey: "k",
      timeoutMs: 30,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    });
    await expect(
      search.search({ query: "q", maxResults: 1 }),
    ).rejects.toMatchObject({ code: "WEB_FETCH_TIMEOUT" });
  });

  it("maps DeepSeek Search results and clips query to 128 chars", async () => {
    const long = "字".repeat(140);
    const search = createDeepSeekSearch({
      apiKey: "sk-test",
      fetch: async (input, init) => {
        expect(String(input)).toContain("/v1/tools/search");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer sk-test",
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(String(body.query).length).toBe(128);
        expect(body.count).toBe(3);
        return Response.json({
          results: [
            {
              title: "DeepSeek V4",
              url: "https://example.com/ds",
              snippet: "short",
              summary: "long summary for the model",
              date: "2026-10-17T00:00:00+00:00",
            },
          ],
        });
      },
    });
    const out = await search.search({ query: long, maxResults: 3 });
    expect(out.sources).toEqual([
      {
        url: "https://example.com/ds",
        title: "DeepSeek V4",
        snippet: "long summary for the model",
        publishedAt: "2026-10-17T00:00:00+00:00",
      },
    ]);
  });

  it("surfaces OpenAI-shaped DeepSeek error.message", async () => {
    const search = createDeepSeekSearch({
      apiKey: "sk",
      fetch: async () =>
        Response.json(
          {
            error: {
              message: "'count' must be between 1 and 50",
              type: "invalid_request_error",
            },
          },
          { status: 400 },
        ),
    });
    await expect(
      search.search({ query: "q", maxResults: 1 }),
    ).rejects.toMatchObject({
      message: "'count' must be between 1 and 50",
      code: "WEB_PROVIDER_ERROR",
    });
  });
});
