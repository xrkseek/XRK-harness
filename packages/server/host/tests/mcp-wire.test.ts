import { describe, expect, it } from "vitest";
import { createPolicyEngine } from "@xrkseek/policy";
import { parseMcpServersEnv, loadMcpToolPlugins } from "../src/mcp-wire.js";

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
});
