import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { materializeTools, TOOL_SEARCH_NAME } from "@xrkseek/core-tools";
import { createHarnessComposition } from "../preset.js";

describe("harness tool_search default", () => {
  it("hides deferred MCP schemas when Face does not pass toolSearchState", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-tool-search-"));
    const composition = createHarnessComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      webTools: false,
      lspTools: false,
    });
    composition.tools.register({
      name: "mcp__s__fat",
      description: "deferred",
      parameters: { type: "object", properties: {} },
      exposure: "deferred",
      async execute() {
        return { content: "ok" };
      },
    });
    expect(composition.tools.get(TOOL_SEARCH_NAME)).toBeDefined();
    const wire = materializeTools(composition.tools, {
      expandedToolNames: new Set(),
    });
    expect(wire.list().some((t) => t.name === "mcp__s__fat")).toBe(false);
    expect(wire.list().some((t) => t.name === TOOL_SEARCH_NAME)).toBe(true);
  });
});
