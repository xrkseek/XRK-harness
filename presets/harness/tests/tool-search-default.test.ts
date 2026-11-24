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

  it("keeps browser_* / computer_use / terminal_* / job_* / cron off wire; leaves web/fs Direct", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-tool-search-browser-"));
    const composition = createHarnessComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      lspTools: false,
      // Default webTools registers browser_*; computer_use may be off in CI.
    });
    expect(composition.tools.get("browser_open")?.exposure).toBe("deferred");
    expect(composition.tools.get("terminal_open")?.exposure).toBe("deferred");
    expect(composition.tools.get("job_list")?.exposure).toBe("deferred");
    // cronjob only registers when Host passes cronScheduler — skip if absent.
    if (composition.tools.get("cronjob")) {
      expect(composition.tools.get("cronjob")?.exposure).toBe("deferred");
    }
    // High-P(use) / seat-core stay Direct (expand tax not worth it).
    expect(composition.tools.get("web_search")?.exposure ?? "direct").toBe(
      "direct",
    );
    expect(composition.tools.get("bash")?.exposure ?? "direct").toBe("direct");
    expect(composition.tools.get("create_worktree")?.exposure ?? "direct").toBe(
      "direct",
    );
    expect(composition.tools.get(TOOL_SEARCH_NAME)?.exposure ?? "direct").toBe(
      "direct",
    );
    const wire = materializeTools(composition.tools, {
      expandedToolNames: new Set(),
    });
    expect(wire.list().some((t) => t.name.startsWith("browser_"))).toBe(false);
    expect(wire.list().some((t) => t.name === "computer_use")).toBe(false);
    expect(wire.list().some((t) => t.name.startsWith("terminal_"))).toBe(false);
    expect(wire.list().some((t) => t.name === "job_list")).toBe(false);
    expect(wire.list().some((t) => t.name === "web_search")).toBe(true);
    expect(wire.list().some((t) => t.name === TOOL_SEARCH_NAME)).toBe(true);
    expect(wire.list().some((t) => t.name === "bash")).toBe(true);

    const expanded = materializeTools(composition.tools, {
      expandedToolNames: new Set(["browser_open", "computer_use", "terminal_open"]),
    });
    expect(expanded.list().some((t) => t.name === "browser_open")).toBe(true);
    expect(expanded.list().some((t) => t.name === "terminal_open")).toBe(true);
  });
});
