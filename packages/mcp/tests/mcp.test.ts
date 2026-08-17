import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createPolicyEngine } from "@xrkseek/policy";
import {
  createMcpClient,
  parsePublicToolName,
  publicToolName,
  registerMcpTools,
} from "../src/index.js";

async function linkedPingServer(): Promise<{
  server: McpServer;
  createTransport: () => Promise<import("@modelcontextprotocol/sdk/shared/transport.js").Transport>;
  close: () => Promise<void>;
}> {
  const server = new McpServer({ name: "test-ping", version: "0.0.0" });
  server.tool("ping", "returns pong", async () => ({
    content: [{ type: "text", text: "pong" }],
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return {
    server,
    createTransport: async () => clientTransport,
    close: async () => {
      await server.close();
    },
  };
}

describe("mcp names", () => {
  it("builds and parses public tool names", () => {
    expect(publicToolName("fs", "read")).toBe("mcp__fs__read");
    expect(parsePublicToolName("mcp__fs__read")).toEqual({
      serverName: "fs",
      rawName: "read",
    });
    expect(() => publicToolName("bad name", "x")).toThrow(/serverName/);
  });
});

describe("mcp client M0", () => {
  it("denies connect by default policy", async () => {
    const client = createMcpClient({
      serverName: "demo",
      command: "false",
      policy: createPolicyEngine(),
    });
    await expect(client.connect()).rejects.toThrow(/policy deny/);
  });

  it("connects in-memory, lists/calls tools, registers on ToolRegistry", async () => {
    const linked = await linkedPingServer();
    const policy = createPolicyEngine({
      defaults: { "mcp.connect": "allow" },
    });
    const client = createMcpClient({
      serverName: "demo",
      command: "unused",
      policy,
      createTransport: linked.createTransport,
    });

    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ping"]);

    const call = await client.callTool("ping", {});
    expect(call.content).toContain("pong");

    const registry = createToolRegistry();
    registry.register({
      name: "mcp__demo__ping",
      description: "explicit",
      parameters: { type: "object" },
      async execute() {
        return { content: "explicit" };
      },
    });
    const wired = await registerMcpTools(registry, client);
    expect(wired.skipped).toEqual([
      {
        publicName: "mcp__demo__ping",
        rawName: "ping",
        reason: "explicit_wins",
      },
    ]);
    expect(wired.applied).toEqual([]);

    wired.dispose();
    await client.dispose();
    await linked.close();
  });

  it("registers tools when name free; dispose unregisters", async () => {
    const linked = await linkedPingServer();
    const client = createMcpClient({
      serverName: "svc",
      command: "unused",
      policy: createPolicyEngine({ defaults: { "mcp.connect": "allow" } }),
      createTransport: linked.createTransport,
    });
    await client.connect();
    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client);
    expect(wired.applied).toEqual([
      { publicName: "mcp__svc__ping", rawName: "ping" },
    ]);
    const tool = registry.get("mcp__svc__ping");
    expect(tool).toBeDefined();
    const out = await tool!.execute({});
    expect(out.content).toContain("pong");

    wired.dispose();
    expect(registry.get("mcp__svc__ping")).toBeUndefined();
    await client.dispose();
    await linked.close();
  });
});
