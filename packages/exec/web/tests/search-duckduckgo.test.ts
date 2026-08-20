import { describe, expect, it } from "vitest";
import { parseDuckDuckGoHtml } from "../src/search-duckduckgo.js";

describe("parseDuckDuckGoHtml", () => {
  it("extracts title, resolved url, and snippet", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Hello &amp; World</a>
      <a class="result__snippet">A short &nbsp; blurb</a>
      <a class="result__a" href="https://other.example/">Other</a>
    `;
    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        url: "https://example.com/page",
        title: "Hello & World",
        snippet: "A short blurb",
      },
      { url: "https://other.example/", title: "Other" },
    ]);
  });
});
