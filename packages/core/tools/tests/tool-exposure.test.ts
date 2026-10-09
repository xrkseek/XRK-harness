import { describe, expect, it } from "vitest";
import {
  TOOL_SEARCH_NAME,
  createToolRegistry,
  createToolSearchTool,
  listForModel,
  materializeTools,
  searchDeferredTools,
  type ToolDefinition,
} from "../src/index.js";

function tool(
  name: string,
  exposure?: "direct" | "deferred" | "hidden",
  description = `${name} desc`,
): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: "object", properties: {} },
    ...(exposure ? { exposure } : {}),
    async execute() {
      return { content: "ok" };
    },
  };
}

describe("listForModel", () => {
  it("fail-opens deferred when tool_search is absent", () => {
    const tools = [tool("a", "direct"), tool("mcp__x__y", "deferred")];
    const listed = listForModel(tools);
    expect(listed.map((t) => t.name).sort()).toEqual(["a", "mcp__x__y"]);
  });

  it("hides deferred until expanded when tool_search is present", () => {
    const tools = [
      tool(TOOL_SEARCH_NAME, "direct"),
      tool("bash", "direct"),
      tool("mcp__s__t", "deferred"),
    ];
    expect(listForModel(tools).map((t) => t.name).sort()).toEqual([
      "bash",
      TOOL_SEARCH_NAME,
    ]);
    expect(
      listForModel(tools, {
        expandedNames: new Set(["mcp__s__t"]),
      }).map((t) => t.name).sort(),
    ).toEqual(["bash", "mcp__s__t", TOOL_SEARCH_NAME]);
  });

  it("never lists hidden", () => {
    expect(
      listForModel([tool("h", "hidden"), tool("d", "direct")]).map((t) => t.name),
    ).toEqual(["d"]);
  });
});

describe("tool_search", () => {
  it("expands matching deferred tools and does not search itself", async () => {
    const reg = createToolRegistry();
    const expanded = new Set<string>();
    const state = {
      listExpanded: () => expanded,
      expand: (names: readonly string[]) => {
        for (const n of names) expanded.add(n);
      },
    };
    reg.register(tool("bash", "direct"));
    reg.register(
      tool("mcp__calendar__create_event", "deferred", "Create a calendar event"),
    );
    reg.register(
      createToolSearchTool({
        listTools: () => reg.list(),
        state,
      }),
    );

    const hits = searchDeferredTools(reg.list(), "calendar event");
    expect(hits.map((h) => h.name)).toEqual(["mcp__calendar__create_event"]);
    expect(hits.every((h) => h.name !== TOOL_SEARCH_NAME)).toBe(true);

    const search = reg.get(TOOL_SEARCH_NAME)!;
    const out = await search.execute({ query: "calendar" });
    expect(out.isError).toBeFalsy();
    expect(expanded.has("mcp__calendar__create_event")).toBe(true);

    const table = materializeTools(reg, { expandedToolNames: expanded });
    expect(table.list().map((t) => t.name).sort()).toEqual([
      "bash",
      "mcp__calendar__create_event",
      TOOL_SEARCH_NAME,
    ]);
    // Settle still resolves deferred even if not expanded (snapshot full).
    expect(table.resolve("mcp__calendar__create_event").ok).toBe(true);
  });
});
