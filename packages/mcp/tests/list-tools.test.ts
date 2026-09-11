import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  drainToolsListPages,
  registerMcpTools,
  type McpClient,
  type McpToolInfo,
} from "../src/index.js";

const A: McpToolInfo = {
  name: "a",
  description: "tool a",
  inputSchema: { type: "object", properties: {} },
};
const B: McpToolInfo = {
  name: "b",
  description: "tool b",
  inputSchema: { type: "object", properties: {} },
};

describe("drainToolsListPages", () => {
  it("drains paginated tools/list responses", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ tools: [A], nextCursor: "cursor1" })
      .mockResolvedValueOnce({ tools: [B], nextCursor: undefined });
    const tools = await drainToolsListPages("srv", fetchPage);
    expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "cursor1");
  });

  it.each([
    ["immediate", ["cursor1", "cursor1"]],
    ["multi-page", ["cursor1", "cursor2", "cursor1"]],
  ] as const)(
    "rejects a pagination cycle through empty pages (%s)",
    async (_kind, cursors) => {
      const fetchPage = vi.fn();
      for (const nextCursor of cursors) {
        fetchPage.mockResolvedValueOnce({ tools: [], nextCursor });
      }
      await expect(drainToolsListPages("srv", fetchPage)).rejects.toThrow(
        /repeated a tools\/list continuation cursor/,
      );
      expect(fetchPage).toHaveBeenCalledTimes(cursors.length);
    },
  );

  it("rejects duplicate tool names across pages", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ tools: [A], nextCursor: "c1" })
      .mockResolvedValueOnce({ tools: [A], nextCursor: undefined });
    await expect(drainToolsListPages("srv", fetchPage)).rejects.toThrow(
      /listed tool "a" more than once/,
    );
  });
});

describe("registerMcpTools pagination failure", () => {
  it("keeps callable tools after a list_changed pagination cycle", async () => {
    let mode: "ok" | "cycle" = "ok";
    const handlers = new Set<() => void | Promise<void>>();
    const client: McpClient = {
      serverName: "srv",
      async connect() {},
      async listTools() {
        if (mode === "ok") return [A];
        // Simulate drainToolsListPages failure surface.
        throw new Error(
          "mcp-client(srv): server repeated a tools/list continuation cursor — invalid tool list",
        );
      },
      async callTool(name) {
        return { content: `called:${name}` };
      },
      onToolsListChanged(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      onConnectionState() {
        return () => {};
      },
      async dispose() {},
    };

    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client);
    expect(wired.applied.map((a) => a.publicName)).toEqual(["mcp__srv__a"]);

    mode = "cycle";
    for (const h of [...handlers]) await h();
    expect(registry.get("mcp__srv__a")).toBeDefined();
    const out = await registry.get("mcp__srv__a")!.execute({});
    expect(out.content).toBe("called:a");

    wired.dispose();
  });
});
