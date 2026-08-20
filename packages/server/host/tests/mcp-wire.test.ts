import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPolicyEngine } from "@xrkseek/policy";
import {
  parseMcpServersEnv,
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  mcpFingerprint,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  type McpRegisteredPlugin,
  type McpServerSpec,
} from "../src/mcp-wire.js";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

describe("host mcp-wire", () => {
  it("parses Cursor mcpServers object JSON", () => {
    const specs = parseMcpServersEnv(
      JSON.stringify({
        mcpServers: {
          "12306-mcp": { command: "npx", args: ["-y", "12306-mcp"] },
        },
      }),
    );
    expect(specs).toEqual([
      { serverName: "12306-mcp", command: "npx", args: ["-y", "12306-mcp"] },
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
  });

  it("fingerprints and drafts skip incomplete rows", () => {
    const stdio: McpServerSpec = {
      serverName: "fs",
      command: "npx",
      args: ["-y", "x"],
      cwd: "/tmp",
    };
    expect(mcpFingerprint(stdio)).toBe(
      JSON.stringify({ n: "fs", c: "npx", a: ["-y", "x"], d: "/tmp", e: [] }),
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
      async dispose() {},
    };
    const stale: McpRegisteredPlugin = {
      id: "mcp:stale",
      kind: "tools",
      tools: [],
      mcpHealth: "connected",
      mcpFingerprint: mcpFingerprint({ serverName: "stale", command: "old" }),
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
    expect(plugins.map((p) => p.id)).toEqual(["mcp:keep"]);
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
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.serverName).toBe("nope");
    expect(plugins).toEqual([]);
  });
});
