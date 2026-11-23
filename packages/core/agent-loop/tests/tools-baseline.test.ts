import { describe, expect, it, beforeEach } from "vitest";
import type { LlmAdapter } from "@xrkseek/llm";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  breakToolsBaseline,
  clearToolsBaselineAnchors,
  hydrateToolsBaselineFromLog,
  recallToolsBaseline,
  rememberToolsBaseline,
} from "../src/tools-baseline.js";
import { forgetSessionProcessCaches } from "../src/session-process-caches.js";

function llm(
  partial: Partial<LlmAdapter> & Pick<LlmAdapter, "id">,
): LlmAdapter {
  return {
    async chat() {
      return { content: "" };
    },
    ...partial,
  };
}

function wire(
  ...names: string[]
): { name: string; description: string; parameters: Record<string, unknown> }[] {
  return names.map((name) => ({
    name,
    description: `desc:${name}`,
    parameters: { type: "object", properties: { [name]: { type: "string" } } },
  }));
}

beforeEach(() => {
  clearToolsBaselineAnchors();
});

describe("tools-baseline anchors", () => {
  it("recalls remembered wire tools and updates on further remember", () => {
    const a = llm({ id: "ds" });
    expect(recallToolsBaseline("s1", a)).toBeUndefined();
    rememberToolsBaseline("s1", a, wire("read_file", "write_file"));
    expect(recallToolsBaseline("s1", a)?.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
    ]);
    expect(recallToolsBaseline("s1", a)?.[0]?.description).toBe(
      "desc:read_file",
    );
    rememberToolsBaseline("s1", a, [
      ...wire("read_file", "write_file"),
      {
        name: "mcp__x",
        description: "desc:mcp__x",
        parameters: {},
      },
    ]);
    expect(recallToolsBaseline("s1", a)?.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "mcp__x",
    ]);
  });

  it("drops the anchor on route change or explicit break", () => {
    const flash = llm({
      id: "ds",
      peekRoute: () => ({ provider: "deepseek", model: "flash" }) as never,
    });
    rememberToolsBaseline("s1", flash, wire("a", "b"));
    const other = llm({
      id: "ds",
      peekRoute: () => ({ provider: "deepseek", model: "v4-pro" }) as never,
    });
    expect(recallToolsBaseline("s1", other)).toBeUndefined();
    rememberToolsBaseline("s1", flash, wire("a", "b"));
    breakToolsBaseline("s1");
    expect(recallToolsBaseline("s1", flash)).toBeUndefined();
  });

  it("hydrates the latest post-compaction request/header tools wire", () => {
    const a = llm({ id: "ds" });
    const events: SessionEvent[] = [
      {
        type: "request/header",
        ts: 1,
        turnId: "t0",
        reason: "initial",
        header: {
          tools: [
            { name: "old_a", description: "old", parameters: {} },
            { name: "old_b", description: "old", parameters: {} },
          ],
          config: { provider: "ds", model: "flash" },
        },
      },
      {
        type: "context/compaction",
        ts: 2,
        reason: "auto",
        summary: "old",
        recent: "",
      },
      {
        type: "request/header",
        ts: 3,
        turnId: "t1",
        reason: "change",
        header: {
          tools: [
            { name: "read_file", description: "r", parameters: { a: 1 } },
            { name: "write_file", description: "w", parameters: { b: 2 } },
          ],
          config: { provider: "ds", model: "flash" },
        },
      },
      {
        type: "request/header",
        ts: 4,
        turnId: "t1",
        reason: "change",
        header: {
          tools: [
            { name: "read_file", description: "r", parameters: { a: 1 } },
            { name: "write_file", description: "w", parameters: { b: 2 } },
            {
              name: "mcp__codegraph",
              description: "mcp",
              parameters: { c: 3 },
            },
          ],
          config: { provider: "ds", model: "flash" },
        },
      },
    ];
    const hydrated = hydrateToolsBaselineFromLog("s1", a, events);
    expect(hydrated?.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "mcp__codegraph",
    ]);
    expect(hydrated?.[0]).toEqual({
      name: "read_file",
      description: "r",
      parameters: { a: 1 },
    });
    expect(recallToolsBaseline("s1", a)?.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "mcp__codegraph",
    ]);
  });

  it("forgetSessionProcessCaches clears tools baseline", () => {
    const a = llm({ id: "ds" });
    rememberToolsBaseline("s1", a, wire("a"));
    forgetSessionProcessCaches("s1");
    expect(recallToolsBaseline("s1", a)).toBeUndefined();
  });
});
