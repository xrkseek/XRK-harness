import { describe, expect, it } from "vitest";
import {
  WEB_FETCH_GUIDANCE,
  WEB_SEARCH_GUIDANCE,
  formatWebFetchGuidance,
  formatWebSearchGuidance,
} from "../src/format.js";

describe("formatWebSearchGuidance", () => {
  it("matches full-surface constant when both web tools are available", () => {
    expect(formatWebSearchGuidance(["web_search", "web_fetch"])).toBe(
      WEB_SEARCH_GUIDANCE,
    );
  });

  it("omits web_fetch follow-up when fetch is filtered out", () => {
    const text = formatWebSearchGuidance(["web_search"]);
    expect(text).toContain("web_search");
    expect(text).not.toContain("web_fetch");
  });

  it("returns empty when web_search is unavailable", () => {
    expect(formatWebSearchGuidance(["web_fetch"])).toBe("");
    expect(formatWebSearchGuidance([])).toBe("");
  });
});

describe("formatWebFetchGuidance", () => {
  it("matches full-surface constant when both web tools are available", () => {
    expect(formatWebFetchGuidance(["web_search", "web_fetch"])).toBe(
      WEB_FETCH_GUIDANCE,
    );
  });

  it("omits web_search example when search is filtered out", () => {
    const text = formatWebFetchGuidance(["web_fetch"]);
    expect(text).toContain("web_fetch");
    expect(text).not.toContain("web_search");
  });

  it("returns empty when web_fetch is unavailable", () => {
    expect(formatWebFetchGuidance(["web_search"])).toBe("");
  });
});
