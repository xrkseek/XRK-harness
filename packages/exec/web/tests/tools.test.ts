import { describe, expect, it } from "vitest";
import {
  createDefaultWebAccess,
  createWebTools,
  formatFetchOutput,
  formatSearchOutput,
  presentFetchResult,
  presentSearchCall,
  presentSearchResult,
} from "../src/index.js";

describe("createWebTools", () => {
  it("registers both tools; empty env cascades to DuckDuckGo when parallel-free fails", async () => {
    const access = createDefaultWebAccess({
      env: {},
      fetch: async (input) => {
        if (String(input).includes("parallel.ai")) {
          throw new Error("parallel unavailable");
        }
        return new Response(
          `<a class="result__a" href="https://example.com/">News</a>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      },
    });
    const tools = createWebTools(access);
    expect(tools.map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    const out = await tools[0]!.execute({ query: "news" });
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain("https://example.com/");
  });

  it("honest error when a keyed provider is pinned without a key", async () => {
    const access = createDefaultWebAccess({
      env: { XRK_WEB_SEARCH_PROVIDER: "tavily" },
    });
    const tools = createWebTools(access);
    const out = await tools[0]!.execute({ query: "news" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_TAVILY_API_KEY/);
  });

  it("search execute writes format text + replay meta", async () => {
    const tools = createWebTools({
      search: {
        async search() {
          return {
            content: "summary",
            truncated: false,
            sources: [
              {
                url: "https://example.com/a",
                title: "A",
                snippet: "alpha",
              },
            ],
          };
        },
      },
    });
    const out = await tools[0]!.execute({ query: "alpha" });
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain("summary");
    expect(out.content).toContain("[A](https://example.com/a)");
    expect(out.meta).toEqual({
      sources: [
        { url: "https://example.com/a", title: "A", snippet: "alpha" },
      ],
      truncated: false,
      answer: "summary",
    });
    expect(presentSearchResult({ query: "alpha" }, out)).toEqual({
      card: "web",
      kind: "search",
      title: "alpha",
      sources: [
        { url: "https://example.com/a", title: "A", snippet: "alpha" },
      ],
      truncated: false,
      answer: "summary",
    });
    expect(presentSearchCall({ query: "alpha" })).toMatchObject({
      card: "generic",
      kind: "search",
      title: "alpha",
    });
  });

  it("fetch execute writes header, body, and fetch-card meta", async () => {
    const tools = createWebTools({
      fetch: {
        async fetch() {
          return {
            url: "https://example.com/p",
            statusCode: 200,
            truncated: false,
            body: { kind: "html", content: "<p>Hello world</p>" },
          };
        },
      },
    });
    const out = await tools[1]!.execute({ url: "https://example.com/p" });
    expect(out.content).toContain("Fetched https://example.com/p (HTTP 200)");
    expect(out.content).toContain("Hello world");
    expect(out.meta).toEqual({
      url: "https://example.com/p",
      statusCode: 200,
      truncated: false,
    });
    expect(presentFetchResult({ url: "https://example.com/p" }, out)).toEqual({
      card: "web",
      kind: "fetch",
      title: "https://example.com/p",
      url: "https://example.com/p",
      statusCode: 200,
      truncated: false,
    });
  });

  it("blocks private-network fetch via the default HTTP provider", async () => {
    const access = createDefaultWebAccess({
      env: {},
      fetch: async () => new Response("should not run"),
    });
    const tools = createWebTools(access);
    const out = await tools[1]!.execute({ url: "http://127.0.0.1/" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/private-network|loopback/);
  });

  it("createDefaultWebAccess wires Tavily when the key is set", async () => {
    const access = createDefaultWebAccess({
      env: { XRK_TAVILY_API_KEY: "k" },
      fetch: async (input) => {
        expect(String(input)).toContain("tavily.com");
        return Response.json({
          answer: "ok",
          results: [{ url: "https://example.com/", title: "Ex" }],
        });
      },
    });
    expect(access.search).toBeDefined();
    const tools = createWebTools(access);
    const out = await tools[0]!.execute({ query: "q" });
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain("ok");
  });
});

describe("format helpers", () => {
  it("search empty sources with no answer", () => {
    expect(
      formatSearchOutput({ sources: [], truncated: false }),
    ).toContain("No results found.");
  });

  it("fetch truncation footer", () => {
    const text = formatFetchOutput(
      {
        url: "https://example.com/",
        statusCode: 200,
        truncated: true,
        body: { kind: "text", content: "body" },
      },
      200_000,
    );
    expect(text).toContain("Content truncated");
  });
});
