import { describe, expect, it } from "vitest";
import { scoreFuzzyQuery, splitFuzzyTokens } from "../src/fuzzy-match.js";
import { searchDeferredTools } from "../src/tool-exposure.js";
import type { ToolDefinition } from "../src/definition.js";

function deferred(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    exposure: "deferred",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: "ok" };
    },
  };
}

describe("scoreFuzzyQuery", () => {
  it("ranks partial name prefixes and snake splits", () => {
    const hay = "browser_open\nOpen a browser tab";
    expect(
      scoreFuzzyQuery("brow", hay, { name: "browser_open" }),
    ).toBeGreaterThan(
      scoreFuzzyQuery("brow", hay, { name: "terminal_list" }),
    );
    expect(
      scoreFuzzyQuery("pty", "terminal_open\nPTY session", {
        name: "terminal_open",
      }),
    ).toBeGreaterThan(0);
    expect(splitFuzzyTokens("mcp calendar").sort()).toEqual(
      ["calendar", "mcp"].sort(),
    );
  });
});

describe("searchDeferredTools fuzzy", () => {
  it("matches partial browser / terminal / mcp queries", () => {
    const tools = [
      deferred("browser_open", "Open a headed browser page"),
      deferred("browser_click", "Click in the browser"),
      deferred("terminal_open", "Open a PTY terminal"),
      deferred("computer_use", "Desktop AX tree + input"),
      deferred("mcp__gh__list_issues", "List GitHub issues"),
    ];
    const brow = searchDeferredTools(tools, "brow").map((t) => t.name);
    expect(brow).toHaveLength(2);
    expect(brow.every((n) => n.startsWith("browser_"))).toBe(true);
    expect(searchDeferredTools(tools, "pty").map((t) => t.name)).toEqual([
      "terminal_open",
    ]);
    expect(searchDeferredTools(tools, "gh issue").map((t) => t.name)).toEqual([
      "mcp__gh__list_issues",
    ]);
  });
});
