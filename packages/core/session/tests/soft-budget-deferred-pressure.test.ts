/**
 * Soft-budget pressure: deferred MCP schemas must not inflate the estimate
 * when tool_search is on the wire (the 133k-vs-2k class of false soft kills).
 *
 * Quantifies disclosure vs dump-all: disclosed estimate must be ≤ half of the
 * dump path (≥100% better headroom) and remain under a tiny conversation ceiling.
 */
import { describe, expect, it } from "vitest";
import {
  createToolSearchTool,
  listForModel,
  TOOL_SEARCH_NAME,
  type ToolDefinition,
} from "@xrkseek/core-tools";
import { estimateRequestTokens } from "../src/compaction.js";

function fatDeferred(count: number): ToolDefinition[] {
  const fatParams = {
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: 48 }, (_, i) => [
        `field_${i}`,
        { type: "string", description: "x".repeat(180) },
      ]),
    ),
  };
  return Array.from({ length: count }, (_, i) => ({
    name: `mcp__pressure__tool_${i}`,
    description: `Deferred MCP tool ${i}: ${"d".repeat(120)}`,
    parameters: fatParams,
    exposure: "deferred" as const,
    async execute() {
      return { content: "ok" };
    },
  }));
}

function asEstimateTools(
  tools: readonly ToolDefinition[],
): {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));
}

describe("soft-budget deferred MCP pressure", () => {
  it("disclosed wire stays ≤½ dump-all estimate under 80 fat deferred tools", () => {
    const deferred = fatDeferred(80);
    const catalog: ToolDefinition[] = [...deferred];
    const search = createToolSearchTool({
      listTools: () => catalog,
      state: {
        listExpanded: () => new Set(),
        expand: () => {},
      },
    });
    catalog.push(search);
    expect(catalog.some((t) => t.name === TOOL_SEARCH_NAME)).toBe(true);

    const disclosed = listForModel(catalog, { expandedNames: new Set() });
    // Legacy fail-open: treat every deferred schema as standing wire cost.
    const dumpAll = catalog;

    const messages = [
      { role: "user" as const, content: "hi — short surface" },
      { role: "assistant" as const, content: "ok" },
    ];
    const disclosedTokens = estimateRequestTokens({
      messages,
      tools: asEstimateTools(disclosed),
    });
    const dumpTokens = estimateRequestTokens({
      messages,
      tools: asEstimateTools(dumpAll),
    });

    // Fail-closed disclosure must beat dump-all by ≥100% headroom (≤½ tokens).
    expect(disclosedTokens).toBeLessThanOrEqual(dumpTokens / 2);
    // Conversation surface stays tiny; dump path is the schema bomb.
    expect(disclosedTokens).toBeLessThan(8_000);
    expect(dumpTokens).toBeGreaterThan(50_000);
    expect(disclosed.every((t) => !t.name.startsWith("mcp__"))).toBe(true);
    expect(disclosed.some((t) => t.name === TOOL_SEARCH_NAME)).toBe(true);
  });

  it("without tool_search, deferred never enter the soft-budget tool price", () => {
    const deferred = fatDeferred(40);
    const direct: ToolDefinition = {
      name: "bash",
      description: "shell",
      parameters: { type: "object", properties: {} },
      exposure: "direct",
      async execute() {
        return { content: "ok" };
      },
    };
    const listed = listForModel([direct, ...deferred]);
    expect(listed.map((t) => t.name)).toEqual(["bash"]);

    const priced = estimateRequestTokens({
      messages: [{ role: "user", content: "hi" }],
      tools: asEstimateTools(listed),
    });
    const dumped = estimateRequestTokens({
      messages: [{ role: "user", content: "hi" }],
      tools: asEstimateTools([direct, ...deferred]),
    });
    expect(priced).toBeLessThanOrEqual(dumped / 2);
    expect(priced).toBeLessThan(2_000);
  });

  it("stress: 200 listForModel passes stay consistent under expansion churn", () => {
    const deferred = fatDeferred(60);
    const expanded = new Set<string>();
    const catalog: ToolDefinition[] = [...deferred];
    const search = createToolSearchTool({
      listTools: () => catalog,
      state: {
        listExpanded: () => expanded,
        expand: (names) => {
          for (const n of names) expanded.add(n);
        },
      },
    });
    catalog.push(search);

    let last = 0;
    for (let i = 0; i < 200; i++) {
      if (i % 17 === 0) {
        const pick = deferred[i % deferred.length];
        if (pick) expanded.add(pick.name);
      }
      const listed = listForModel(catalog, { expandedNames: expanded });
      const tokens = estimateRequestTokens({
        messages: [{ role: "user", content: `turn-${i}` }],
        tools: asEstimateTools(listed),
      });
      expect(listed.some((t) => t.name === TOOL_SEARCH_NAME)).toBe(true);
      expect(
        listed
          .filter((t) => t.exposure === "deferred")
          .every((t) => expanded.has(t.name)),
      ).toBe(true);
      // Expanding can only grow or hold the estimate (allow tiny stringify noise).
      expect(tokens).toBeGreaterThanOrEqual(Math.floor(last * 0.95));
      last = tokens;
    }
    expect(expanded.size).toBeGreaterThan(5);
  });
});
