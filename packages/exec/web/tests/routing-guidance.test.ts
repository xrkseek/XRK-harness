import { describe, expect, it } from "vitest";
import {
  WEB_FAMILY_GUIDANCE,
  WEB_FETCH_GUIDANCE,
  WEB_SEARCH_GUIDANCE,
  formatBrowserGuidance,
  formatWebFamilyGuidance,
  formatWebFetchGuidance,
  formatWebSearchGuidance,
} from "../src/format.js";

describe("formatWebSearchGuidance", () => {
  it("matches full-surface constant", () => {
    expect(formatWebSearchGuidance(["web_search", "web_fetch"])).toBe(
      WEB_SEARCH_GUIDANCE,
    );
  });

  it("does not name web_fetch (orthogonal)", () => {
    const text = formatWebSearchGuidance(["web_search", "web_fetch"]);
    expect(text).toContain("web_search");
    expect(text).not.toContain("web_fetch");
  });

  it("returns empty when web_search is unavailable", () => {
    expect(formatWebSearchGuidance(["web_fetch"])).toBe("");
    expect(formatWebSearchGuidance([])).toBe("");
  });
});

describe("formatWebFetchGuidance", () => {
  it("matches full-surface constant", () => {
    expect(formatWebFetchGuidance(["web_search", "web_fetch"])).toBe(
      WEB_FETCH_GUIDANCE,
    );
  });

  it("keeps binary/proxy contracts without naming search/browser", () => {
    const text = formatWebFetchGuidance(["web_fetch", "web_search", "browser_open"]);
    expect(text).toContain("web_fetch");
    expect(text).toMatch(/binar/i);
    expect(text).toMatch(/proxy/i);
    expect(text).not.toContain("web_search");
    expect(text).not.toContain("browser");
    expect(text).not.toContain("Playwright");
  });

  it("returns empty when web_fetch is unavailable", () => {
    expect(formatWebFetchGuidance(["web_search"])).toBe("");
  });
});

describe("formatBrowserGuidance", () => {
  it("mentions snapshot/act without web_* or computer_use routing", () => {
    const text = formatBrowserGuidance(["browser_open", "browser_act"]);
    expect(text).toContain("browser_open");
    expect(text).toContain("browser_act");
    expect(text).not.toContain("web_fetch");
    expect(text).not.toContain("web_search");
    expect(text).not.toContain("computer_use");
  });

  it("returns empty when browser tools are unavailable", () => {
    expect(formatBrowserGuidance(["web_fetch"])).toBe("");
  });
});

describe("formatWebFamilyGuidance", () => {
  it("matches full-surface constant and owns cross-tool routing", () => {
    expect(
      formatWebFamilyGuidance([
        "web_search",
        "web_fetch",
        "browser_open",
        "computer_use",
      ]),
    ).toBe(WEB_FAMILY_GUIDANCE);
    expect(WEB_FAMILY_GUIDANCE).toContain("web_search");
    expect(WEB_FAMILY_GUIDANCE).toContain("web_fetch");
    expect(WEB_FAMILY_GUIDANCE).toContain("browser_*");
    expect(WEB_FAMILY_GUIDANCE).toContain("computer_use");
  });

  it("returns empty when no web tools", () => {
    expect(formatWebFamilyGuidance(["computer_use"])).toBe("");
  });
});
