import { describe, expect, it } from "vitest";
import {
  applyStandingDeferredExposure,
  createToolRegistry,
  listForModel,
  STANDING_DEFERRED_TOOL_NAMES,
  TOOL_SEARCH_NAME,
  type ToolDefinition,
} from "../src/index.js";

function stub(name: string, exposure?: "direct" | "deferred"): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    ...(exposure ? { exposure } : {}),
    async execute() {
      return { content: "ok" };
    },
  };
}

describe("applyStandingDeferredExposure", () => {
  it("moves listed Direct tools onto Deferred and leaves cores Direct", () => {
    const tools = createToolRegistry();
    tools.register(stub("bash"));
    tools.register(stub("terminal_open"));
    tools.register(stub("web_search"));
    tools.register(stub("cronjob"));
    tools.register(stub("team_list"));
    tools.register(stub("session_search"));
    tools.register(stub("settings_get"));
    tools.register(stub(TOOL_SEARCH_NAME, "direct"));
    tools.register(stub("browser_open", "deferred"));

    applyStandingDeferredExposure(tools);

    expect(tools.get("terminal_open")?.exposure).toBe("deferred");
    expect(tools.get("cronjob")?.exposure).toBe("deferred");
    // Not on the standing list — Direct (web high-P; session find-chain;
    // settings is 向阳-only and must not be globally deferred-advertised).
    expect(tools.get("web_search")?.exposure).toBeUndefined();
    expect(tools.get("session_search")?.exposure).toBeUndefined();
    expect(tools.get("settings_get")?.exposure).toBeUndefined();
    expect(tools.get("bash")?.exposure).toBeUndefined();
    expect(tools.get("team_list")?.exposure).toBeUndefined();
    expect(tools.get("browser_open")?.exposure).toBe("deferred");

    const wire = listForModel(tools.list(), { expandedNames: new Set() });
    const names = wire.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "bash",
        "team_list",
        "web_search",
        "session_search",
        "settings_get",
        TOOL_SEARCH_NAME,
      ].sort(),
    );
  });

  it("only lists universal rare packs — not seat-only or find-chain tools", () => {
    for (const name of [
      "terminal_open",
      "cronjob",
      "job_list",
      "propose_skill",
    ]) {
      expect(STANDING_DEFERRED_TOOL_NAMES.has(name)).toBe(true);
    }
    for (const name of [
      "settings_get",
      "settings_mutate",
      "session_search",
      "session_inspect",
      "web_search",
      "team_list",
      "team_save",
      "thread_upsert",
      "thread_message",
      "workspace_create",
      "bash",
    ]) {
      expect(STANDING_DEFERRED_TOOL_NAMES.has(name)).toBe(false);
    }
  });
});
