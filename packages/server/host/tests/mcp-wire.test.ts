import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { McpClient } from "@xrkseek/mcp";
import { MCP_RESOURCES_PLUGIN_ID } from "@xrkseek/mcp";
import { createPolicyEngine } from "@xrkseek/policy";
import {
  parseMcpServersEnv,
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  mcpFingerprint,
  readMcpAllowFromHostSettings,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  resetLastGoodHostMcpWireCaches,
  type McpRegisteredPlugin,
  type McpServerSpec,
} from "../src/mcp-wire.js";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

afterEach(() => {
  resetLastGoodHostMcpWireCaches();
});

function stubMcpClient(serverName: string): McpClient {
  return {
    serverName,
    async connect() {},
    async listTools() {
      return [];
    },
    async listResources() {
      return { items: [] };
    },
    async listResourceTemplates() {
      return { items: [] };
    },
    async readResource() {
      return { contents: [] };
    },
    async callTool() {
      return { content: "" };
    },
    onToolsListChanged() {
      return () => {};
    },
    onConnectionState() {
      return () => {};
    },
    async dispose() {},
  };
}

describe("host mcp-wire", () => {
  it("parses Cursor mcpServers object JSON", () => {
    const specs = parseMcpServersEnv(
      JSON.stringify({
        mcpServers: {
          demo: { command: "npx", args: ["-y", "demo-mcp"] },
        },
      }),
    );
    expect(specs).toEqual([
      { serverName: "demo", command: "npx", args: ["-y", "demo-mcp"] },
    ]);
  });

  it("denies load without allow when default policy denies", async () => {
    await expect(
      loadMcpToolPlugins({
        specs: [{ serverName: "demo", command: "false" }],
        policy: createPolicyEngine(),
      }),
    ).rejects.toThrow(/policy deny/);
  });

  it("reads Face host-settings.json mcp.servers and ignores env maps", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-wire-"));
    const file = path.join(dir, "host-settings.json");
    await writeFile(
      file,
      `${JSON.stringify({
        mcp: {
          servers: [
            { serverName: "fs", command: "npx", args: ["-y", "x"] },
            { serverName: "remote", url: "https://example.com/mcp" },
            { serverName: "skip-me" },
            {
              serverName: "with-env",
              command: "npx",
              env: { TOKEN: "secret" },
            },
          ],
        },
      })}\n`,
      "utf8",
    );
    const specs = readMcpServersFromHostSettings(file);
    expect(specs).toEqual([
      { serverName: "fs", command: "npx", args: ["-y", "x"] },
      { serverName: "remote", url: "https://example.com/mcp" },
      { serverName: "with-env", command: "npx" },
    ]);
    expect(JSON.stringify(specs)).not.toContain("secret");
    expect(readMcpServersFromHostSettings(path.join(dir, "missing.json"))).toEqual(
      [],
    );

    // Corrupt the same file after a good read — keep last good, do not wipe.
    await writeFile(file, "{ not-json\n", "utf8");
    expect(readMcpServersFromHostSettings(file)).toEqual([
      { serverName: "fs", command: "npx", args: ["-y", "x"] },
      { serverName: "remote", url: "https://example.com/mcp" },
      { serverName: "with-env", command: "npx" },
    ]);
  });

  it("keeps last-good servers when mcp.servers is omitted (truncated write)", async () => {
    resetLastGoodHostMcpWireCaches();
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-trunc-"));
    const file = path.join(dir, "host-settings.json");
    await writeFile(
      file,
      `${JSON.stringify({
        mcp: {
          servers: [{ serverName: "keep", command: "npx" }],
          allowConnect: true,
        },
      })}\n`,
      "utf8",
    );
    expect(readMcpServersFromHostSettings(file)).toEqual([
      { serverName: "keep", command: "npx" },
    ]);
    expect(readMcpAllowFromHostSettings(file)).toBe(true);

    await writeFile(
      file,
      `${JSON.stringify({ mcp: { allowConnect: true } })}\n`,
      "utf8",
    );
    expect(readMcpServersFromHostSettings(file)).toEqual([
      { serverName: "keep", command: "npx" },
    ]);
    expect(readMcpAllowFromHostSettings(file)).toBe(true);

    await writeFile(file, "{ broken", "utf8");
    expect(readMcpAllowFromHostSettings(file)).toBe(true);
  });

  it("fingerprints and drafts skip incomplete rows", () => {
    const stdio: McpServerSpec = {
      serverName: "fs",
      command: "npx",
      args: ["-y", "x"],
      cwd: "/tmp",
    };
    expect(mcpFingerprint(stdio)).toBe(
      JSON.stringify({
        n: "fs",
        c: "npx",
        a: ["-y", "x"],
        d: "/tmp",
        w: false,
        e: [],
      }),
    );
    expect(mcpFingerprint({ serverName: "r", url: "https://x" })).toBe(
      JSON.stringify({ n: "r", u: "https://x" }),
    );
    expect(
      mcpDraftsToSpecs([
        { serverName: "ok", command: "npx" },
        { serverName: "skip" },
        { serverName: "http", url: "https://example.com" },
      ]),
    ).toEqual([
      { serverName: "ok", command: "npx" },
      { serverName: "http", url: "https://example.com" },
    ]);
  });

  it("reconcile keeps matching fingerprints and removes stale plugins", async () => {
    const spec: McpServerSpec = { serverName: "keep", command: "npx" };
    const keep: McpRegisteredPlugin = {
      id: "mcp:keep",
      kind: "tools",
      tools: [],
      mcpHealth: "connected",
      mcpFingerprint: mcpFingerprint(spec),
      mcpClient: stubMcpClient("keep"),
      async dispose() {},
    };
    const stale: McpRegisteredPlugin = {
      id: "mcp:stale",
      kind: "tools",
      tools: [],
      mcpHealth: "connected",
      mcpFingerprint: mcpFingerprint({ serverName: "stale", command: "old" }),
      mcpClient: stubMcpClient("stale"),
      async dispose() {},
    };
    const plugins: RegisteredPlugin[] = [keep, stale];
    const result = await reconcileMcpToolPlugins({
      desired: [spec],
      list: () => plugins,
      register: (plugin) => {
        plugins.push(plugin);
      },
      unregister: async (id) => {
        const i = plugins.findIndex((p) => p.id === id);
        if (i < 0) return;
        await plugins[i]?.dispose?.();
        plugins.splice(i, 1);
      },
      allowConnect: true,
    });
    expect(result.kept).toEqual(["mcp:keep"]);
    expect(result.removed).toEqual(["mcp:stale"]);
    expect(result.added).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.parked).toEqual([]);
    expect(plugins.map((p) => p.id).sort()).toEqual(
      ["mcp:keep", MCP_RESOURCES_PLUGIN_ID].sort(),
    );
    const resources = plugins.find((p) => p.id === MCP_RESOURCES_PLUGIN_ID);
    expect(resources?.kind).toBe("tools");
    expect(resources && "tools" in resources ? resources.tools.length : 0).toBe(
      3,
    );
  });

  it("reconcile replaces gave-up plugins with the same fingerprint", async () => {
    const spec: McpServerSpec = {
      serverName: "dead",
      command: "xrk-mcp-missing-binary-xyz",
    };
    const dead: McpRegisteredPlugin = {
      id: "mcp:dead",
      kind: "tools",
      tools: [],
      mcpHealth: "gave-up",
      mcpFingerprint: mcpFingerprint(spec),
      mcpClient: stubMcpClient("dead"),
      async dispose() {},
    };
    const plugins: RegisteredPlugin[] = [dead];
    const result = await reconcileMcpToolPlugins({
      desired: [spec],
      list: () => plugins,
      register: (plugin) => {
        plugins.push(plugin);
      },
      unregister: async (id) => {
        const i = plugins.findIndex((p) => p.id === id);
        if (i < 0) return;
        await plugins[i]?.dispose?.();
        plugins.splice(i, 1);
      },
      allowConnect: true,
    });
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual(["mcp:dead"]);
    // Replace attempted; missing binary fails closed and is collected.
    expect(result.failures[0]?.serverName).toBe("dead");
    expect(plugins.map((p) => p.id)).not.toContain("mcp:dead");
    expect(plugins.map((p) => p.id)).not.toContain(MCP_RESOURCES_PLUGIN_ID);
  });

  it("reconcile drops mcp-resources when allowConnect is off", async () => {
    const plugins: RegisteredPlugin[] = [
      {
        id: "mcp:demo",
        kind: "tools",
        tools: [],
        mcpHealth: "connected",
        mcpFingerprint: mcpFingerprint({
          serverName: "demo",
          command: "npx",
        }),
        mcpClient: stubMcpClient("demo"),
        async dispose() {},
      } satisfies McpRegisteredPlugin,
      {
        id: MCP_RESOURCES_PLUGIN_ID,
        kind: "tools",
        tools: [],
      },
    ];
    const result = await reconcileMcpToolPlugins({
      desired: [{ serverName: "demo", command: "npx" }],
      list: () => plugins,
      register: (plugin) => {
        plugins.push(plugin);
      },
      unregister: async (id) => {
        const i = plugins.findIndex((p) => p.id === id);
        if (i < 0) return;
        await plugins[i]?.dispose?.();
        plugins.splice(i, 1);
      },
      allowConnect: false,
    });
    expect(result.parked).toEqual(["demo"]);
    expect(plugins).toEqual([]);
  });

  it("reconcile collects connect failures without aborting the batch", async () => {
    const plugins: RegisteredPlugin[] = [];
    const result = await reconcileMcpToolPlugins({
      desired: [{ serverName: "nope", command: "xrk-mcp-missing-binary-xyz" }],
      list: () => plugins,
      register: (plugin) => {
        plugins.push(plugin);
      },
      unregister: async () => {},
      allowConnect: true,
    });
    expect(result.added).toEqual([]);
    expect(result.parked).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.serverName).toBe("nope");
    expect(plugins).toEqual([]);
  });

  it("reconcile parks desired servers when mcp.connect is denied", async () => {
    const plugins: RegisteredPlugin[] = [];
    const result = await reconcileMcpToolPlugins({
      desired: [{ serverName: "playwright", command: "npx" }],
      list: () => plugins,
      register: (plugin) => {
        plugins.push(plugin);
      },
      unregister: async () => {},
      // Default policy denies mcp.connect; no allowConnect.
    });
    expect(result.added).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.parked).toEqual(["playwright"]);
    expect(plugins).toEqual([]);
  });
});
