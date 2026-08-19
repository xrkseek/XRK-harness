import { describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createPolicyEngine } from "@xrkseek/policy";
import {
  createMcpClient,
  parsePublicToolName,
  publicToolName,
  registerMcpTools,
  type McpClient,
  type McpToolInfo,
} from "../src/index.js";

const PING: McpToolInfo = {
  name: "ping",
  description: "returns pong",
  inputSchema: { type: "object", properties: {} },
};

async function linkedPingServer(opts?: {
  listChanged?: boolean;
}): Promise<{
  server: McpServer;
  createTransport: () => Promise<import("@modelcontextprotocol/sdk/shared/transport.js").Transport>;
  close: () => Promise<void>;
}> {
  const server = new McpServer(
    { name: "test-ping", version: "0.0.0" },
    opts?.listChanged
      ? { capabilities: { tools: { listChanged: true } } }
      : undefined,
  );
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

function allowPolicy() {
  return createPolicyEngine({ defaults: { "mcp.connect": "allow" } });
}

function stubClient(init: {
  serverName: string;
  tools: McpToolInfo[];
}): McpClient & { failNextList: boolean; emitChanged(): Promise<void> } {
  const handlers = new Set<() => void | Promise<void>>();
  const self = {
    serverName: init.serverName,
    failNextList: false,
    async connect() {},
    async listTools() {
      if (self.failNextList) {
        self.failNextList = false;
        throw new Error("flaky list");
      }
      return init.tools;
    },
    async callTool() {
      return { content: "" };
    },
    onToolsListChanged(handler: () => void | Promise<void>) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onConnectionState() {
      return () => {};
    },
    async dispose() {},
    async emitChanged() {
      for (const handler of [...handlers]) await handler();
    },
  };
  return self;
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

  it("coalesces concurrent connect into one handshake", async () => {
    const linked = await linkedPingServer();
    let opens = 0;
    const client = createMcpClient({
      serverName: "once",
      command: "unused",
      policy: allowPolicy(),
      createTransport: async () => {
        opens += 1;
        await new Promise((r) => setTimeout(r, 20));
        return linked.createTransport();
      },
    });
    await Promise.all([client.connect(), client.connect()]);
    expect(opens).toBe(1);
    expect((await client.listTools()).map((t) => t.name)).toEqual(["ping"]);
    await client.dispose();
    await linked.close();
  });

  it("dispose during connect does not leave a live client", async () => {
    const linked = await linkedPingServer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = createMcpClient({
      serverName: "race",
      command: "unused",
      policy: allowPolicy(),
      createTransport: async () => {
        await gate;
        return linked.createTransport();
      },
    });
    const connecting = client.connect();
    await client.dispose();
    release();
    await expect(connecting).rejects.toThrow(/disposed/);
    await expect(client.listTools()).rejects.toThrow(/not connected|disposed/);
    await linked.close();
  });

  it("connects in-memory, lists/calls tools, registers on ToolRegistry", async () => {
    const linked = await linkedPingServer();
    const client = createMcpClient({
      serverName: "demo",
      command: "unused",
      policy: allowPolicy(),
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
      policy: allowPolicy(),
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

  it("accepts streamable-http transport option", async () => {
    const linked = await linkedPingServer();
    const client = createMcpClient({
      transport: "http",
      serverName: "httpdemo",
      url: "http://127.0.0.1:9/mcp",
      reconnectionOptions: { maxRetries: 3 },
      policy: allowPolicy(),
      createTransport: linked.createTransport,
    });
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ping"]);
    await client.dispose();
    await linked.close();
  });

  it("re-syncs registry on tools/list_changed", async () => {
    const linked = await linkedPingServer({ listChanged: true });
    const client = createMcpClient({
      serverName: "live",
      command: "unused",
      policy: allowPolicy(),
      createTransport: linked.createTransport,
    });
    await client.connect();
    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client);
    expect(registry.get("mcp__live__ping")).toBeDefined();

    linked.server.tool("echo", "returns echo", async () => ({
      content: [{ type: "text", text: "echo" }],
    }));
    linked.server.sendToolListChanged();

    await vi.waitFor(() => {
      expect(registry.get("mcp__live__echo")).toBeDefined();
    });
    expect(wired.applied.map((a) => a.rawName).sort()).toEqual(["echo", "ping"]);
    expect(registry.get("mcp__live__ping")).toBeDefined();

    wired.dispose();
    expect(registry.get("mcp__live__ping")).toBeUndefined();
    expect(registry.get("mcp__live__echo")).toBeUndefined();

    linked.server.sendToolListChanged();
    await new Promise((r) => setTimeout(r, 30));
    expect(registry.get("mcp__live__echo")).toBeUndefined();

    await client.dispose();
    await linked.close();
  });

  it("watch:false does not re-sync on list_changed", async () => {
    const linked = await linkedPingServer({ listChanged: true });
    const client = createMcpClient({
      serverName: "nowatch",
      command: "unused",
      policy: allowPolicy(),
      createTransport: linked.createTransport,
    });
    await client.connect();
    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client, { watch: false });
    linked.server.tool("echo", "returns echo", async () => ({
      content: [{ type: "text", text: "echo" }],
    }));
    linked.server.sendToolListChanged();
    await new Promise((r) => setTimeout(r, 40));
    expect(registry.get("mcp__nowatch__echo")).toBeUndefined();
    wired.dispose();
    await client.dispose();
    await linked.close();
  });

  it("keeps previous generation when list_changed re-list fails", async () => {
    const client = stubClient({ serverName: "flaky", tools: [PING] });
    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client);
    expect(registry.get("mcp__flaky__ping")).toBeDefined();

    client.failNextList = true;
    await client.emitChanged();
    expect(registry.get("mcp__flaky__ping")).toBeDefined();
    expect(client.failNextList).toBe(false);

    wired.dispose();
  });
});
