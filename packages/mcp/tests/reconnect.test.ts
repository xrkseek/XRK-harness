/**
 * Stdio supervisor: crash-driven reconnect with bounded backoff.
 * Isolated so vi.mock of the MCP SDK does not pollute mcp.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPolicyEngine } from "@xrkseek/policy";
import { createToolRegistry } from "@xrkseek/core-tools";

const {
  mockConnect,
  mockClose,
  mockListTools,
  mockCallTool,
  MockClient,
  instances,
} = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>();
  const mockClose = vi.fn<() => Promise<void>>();
  const mockListTools = vi.fn<() => Promise<unknown>>();
  const mockCallTool = vi.fn<() => Promise<unknown>>();
  class MockClient {
    onclose: (() => void) | undefined;
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
    setNotificationHandler = vi.fn();
    removeNotificationHandler = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  const instances: MockClient[] = [];
  return {
    mockConnect,
    mockClose,
    mockListTools,
    mockCallTool,
    MockClient,
    instances,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

import {
  createMcpClient,
  registerMcpTools,
  resolveReconnectPolicy,
} from "../src/index.js";

function allowPolicy() {
  return createPolicyEngine({ defaults: { "mcp.connect": "allow" } });
}

function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[] } {
  return {
    tools: names.map((name) => ({ name, inputSchema: { type: "object" } })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("resolveReconnectPolicy", () => {
  it("rejects unknown keys and inverted bounds", () => {
    expect(() => resolveReconnectPolicy({ enabled: true, bogus: 1 } as never, "reconnect"))
      .toThrow(/not a reconnect option/);
    expect(() => resolveReconnectPolicy({ initialDelayMs: 40, maxDelayMs: 5 }, "reconnect"))
      .toThrow(/less than or equal/);
    expect(() => resolveReconnectPolicy({ maxAttempts: 0 }, "reconnect"))
      .toThrow(/positive integer/);
  });
});

describe("mcp reconnect supervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.();
      return Promise.resolve();
    });
    mockListTools.mockResolvedValue(listing("remote"));
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("reconnects after onclose, re-lists through the new generation, and serves calls", async () => {
    const logs: string[] = [];
    const states: string[] = [];
    const client = createMcpClient({
      serverName: "srv",
      command: "echo",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
      reconnect: { initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 5 },
      onLog: (_level, message) => {
        logs.push(message);
      },
    });
    client.onConnectionState((state) => {
      states.push(state.status);
    });
    await client.connect();
    expect(instances).toHaveLength(1);
    expect((await client.listTools()).map((t) => t.name)).toEqual(["remote"]);

    mockListTools.mockResolvedValue(listing("revived"));
    instances[0]!.onclose?.();

    await vi.waitFor(() => {
      expect(instances).toHaveLength(2);
    });
    await vi.waitFor(async () => {
      expect((await client.listTools()).map((t) => t.name)).toEqual(["revived"]);
    });
    const call = await client.callTool("revived", {});
    expect(call.content).toContain("ok");
    expect(logs.some((line) => line.includes("reconnecting in 5ms (attempt 1/5)"))).toBe(true);
    expect(logs.some((line) => line.includes("reconnected"))).toBe(true);
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("connected");

    instances[0]!.onclose?.();
    await sleep(30);
    expect(instances).toHaveLength(2);

    await client.dispose();
  });

  it("stops at the failure cap, unregisters tools, and reports gave-up", async () => {
    const logs: string[] = [];
    const client = createMcpClient({
      serverName: "srv",
      command: "echo",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
      reconnect: { initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 },
      onLog: (_level, message) => {
        logs.push(message);
      },
    });
    await client.connect();
    const registry = createToolRegistry();
    const wired = await registerMcpTools(registry, client);
    expect(registry.get("mcp__srv__remote")).toBeDefined();

    mockConnect.mockRejectedValue(new Error("server gone"));
    instances[0]!.onclose?.();

    await vi.waitFor(() => {
      expect(logs.some((line) => line.includes("giving up after 2 consecutive failed reconnect attempts"))).toBe(true);
    });
    await vi.waitFor(() => {
      expect(registry.get("mcp__srv__remote")).toBeUndefined();
    });
    // Initial connect + exactly maxAttempts reconnect attempts.
    expect(mockConnect).toHaveBeenCalledTimes(3);
    await sleep(30);
    expect(mockConnect).toHaveBeenCalledTimes(3);

    wired.dispose();
    await client.dispose();
  });

  it("does not reconnect when disabled", async () => {
    const logs: string[] = [];
    const client = createMcpClient({
      serverName: "srv",
      command: "echo",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
      reconnect: { enabled: false },
      onLog: (_level, message) => {
        logs.push(message);
      },
    });
    await client.connect();
    instances[0]!.onclose?.();
    await sleep(20);
    expect(instances).toHaveLength(1);
    expect(logs.some((line) => line.includes("reconnect is disabled"))).toBe(true);
    await expect(client.listTools()).rejects.toThrow(/not connected/);
    await client.dispose();
  });

  it("does not process-supervise HTTP by default", async () => {
    const client = createMcpClient({
      transport: "http",
      serverName: "remote",
      url: "http://127.0.0.1:9/mcp",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
    });
    await client.connect();
    instances[0]!.onclose?.();
    await sleep(20);
    expect(instances).toHaveLength(1);
    await client.dispose();
  });

  it("cancels a pending backoff on dispose", async () => {
    const client = createMcpClient({
      serverName: "srv",
      command: "echo",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
      reconnect: { initialDelayMs: 200, maxDelayMs: 400, maxAttempts: 5 },
    });
    await client.connect();
    instances[0]!.onclose?.();
    await client.dispose();
    await sleep(50);
    expect(instances).toHaveLength(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("resets the outage budget after the stability window", async () => {
    const logs: string[] = [];
    const client = createMcpClient({
      serverName: "srv",
      command: "echo",
      policy: allowPolicy(),
      createTransport: async () => ({ close: async () => {} }) as never,
      reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 2 },
      onLog: (_level, message) => {
        logs.push(message);
      },
    });
    await client.connect();
    await sleep(25);
    mockConnect.mockRejectedValueOnce(new Error("blip"));
    instances[0]!.onclose?.();
    await vi.waitFor(() => {
      expect(instances.length).toBeGreaterThanOrEqual(2);
    });
    await vi.waitFor(async () => {
      await client.listTools();
    });
    expect(logs.some((line) => line.includes("attempt 1/2"))).toBe(true);
    await client.dispose();
  });
});
