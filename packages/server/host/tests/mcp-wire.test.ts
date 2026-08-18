import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPolicyEngine } from "@xrkseek/policy";
import {
  parseMcpServersEnv,
  loadMcpToolPlugins,
  readMcpServersFromHostSettings,
} from "../src/mcp-wire.js";

describe("host mcp-wire", () => {
  it("parses XRK_MCP_SERVERS JSON", () => {
    const specs = parseMcpServersEnv(
      JSON.stringify([
        { serverName: "demo", command: "npx", args: ["-y", "x"] },
      ]),
    );
    expect(specs).toEqual([
      { serverName: "demo", command: "npx", args: ["-y", "x"] },
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
});
