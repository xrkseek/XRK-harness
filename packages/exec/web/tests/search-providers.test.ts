import { describe, expect, it } from "vitest";
import {
  createBraveSearch,
  createSearchFromEnv,
  createTavilySearch,
  resolveSearchProviderId,
  searchUnavailableMessage,
} from "../src/search-providers.js";

describe("search provider selection", () => {
  it("prefers Tavily when both keys exist unless pinned", () => {
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
    expect(resolveSearchProviderId({})).toBeUndefined();
    expect(
      searchUnavailableMessage({ XRK_WEB_SEARCH_PROVIDER: "exa" }),
    ).toMatch(/Unknown XRK_WEB_SEARCH_PROVIDER/);
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

  it("createSearchFromEnv is undefined without a key", () => {
    expect(createSearchFromEnv({ env: {} })).toBeUndefined();
    expect(
      createSearchFromEnv({
        env: { XRK_BRAVE_SEARCH_API_KEY: "b" },
        fetch: async () => Response.json({ web: { results: [] } }),
      }),
    ).toBeDefined();
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
});
