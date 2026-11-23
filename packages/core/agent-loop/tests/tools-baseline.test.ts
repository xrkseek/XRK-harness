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

beforeEach(() => {
  clearToolsBaselineAnchors();
});

describe("tools-baseline anchors", () => {
  it("recalls remembered wire order and updates on further remember", () => {
    const a = llm({ id: "ds" });
    expect(recallToolsBaseline("s1", a)).toBeUndefined();
    rememberToolsBaseline("s1", a, ["read_file", "write_file"]);
    expect(recallToolsBaseline("s1", a)).toEqual(["read_file", "write_file"]);
    rememberToolsBaseline("s1", a, ["read_file", "write_file", "mcp__x"]);
    expect(recallToolsBaseline("s1", a)).toEqual([
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
    rememberToolsBaseline("s1", flash, ["a", "b"]);
    const other = llm({
      id: "ds",
      peekRoute: () => ({ provider: "deepseek", model: "v4-pro" }) as never,
    });
    expect(recallToolsBaseline("s1", other)).toBeUndefined();
    rememberToolsBaseline("s1", flash, ["a", "b"]);
    breakToolsBaseline("s1");
    expect(recallToolsBaseline("s1", flash)).toBeUndefined();
  });

  it("hydrates the latest post-compaction request/header tools order", () => {
    const a = llm({ id: "ds" });
    const events: SessionEvent[] = [
      {
        type: "request/header",
        ts: 1,
        turnId: "t0",
        reason: "initial",
        header: {
          tools: [
            { name: "old_a", description: "", parameters: {} },
            { name: "old_b", description: "", parameters: {} },
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
            { name: "read_file", description: "", parameters: {} },
            { name: "write_file", description: "", parameters: {} },
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
            { name: "read_file", description: "", parameters: {} },
            { name: "write_file", description: "", parameters: {} },
            { name: "mcp__codegraph", description: "", parameters: {} },
          ],
          config: { provider: "ds", model: "flash" },
        },
      },
    ];
    expect(hydrateToolsBaselineFromLog("s1", a, events)).toEqual([
      "read_file",
      "write_file",
      "mcp__codegraph",
    ]);
    expect(recallToolsBaseline("s1", a)).toEqual([
      "read_file",
      "write_file",
      "mcp__codegraph",
    ]);
  });

  it("forgetSessionProcessCaches clears tools baseline", () => {
    const a = llm({ id: "ds" });
    rememberToolsBaseline("s1", a, ["a"]);
    forgetSessionProcessCaches("s1");
    expect(recallToolsBaseline("s1", a)).toBeUndefined();
  });
});
