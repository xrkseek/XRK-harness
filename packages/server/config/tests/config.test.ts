import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultSessionsDir,
  loadHostConfig,
  parseMcpServersJson,
  parseMcpServersValue,
  resolveXrkHome,
} from "../src/index.js";

describe("loadHostConfig", () => {
  it("reads XRK_PLUGINS_DIR", () => {
    const cfg = loadHostConfig({
      env: { XRK_PLUGINS_DIR: "  ./extensions  " },
    });
    expect(cfg.runtime.pluginsDir).toBe("./extensions");
  });

  it("patch.pluginsDir overrides env", () => {
    const cfg = loadHostConfig({
      env: { XRK_PLUGINS_DIR: "./a" },
      patch: { pluginsDir: "./b" },
    });
    expect(cfg.runtime.pluginsDir).toBe("./b");
  });

  it("omits pluginsDir when unset", () => {
    const cfg = loadHostConfig({ env: {} });
    expect(cfg.runtime.pluginsDir).toBeUndefined();
  });

  it("reads XRK_WEB_DIST", () => {
    const cfg = loadHostConfig({
      env: { XRK_WEB_DIST: "  apps/web/dist  " },
    });
    expect(cfg.runtime.webDist).toBe("apps/web/dist");
  });

  it("reads XRK_SESSIONS_DIR", () => {
    const cfg = loadHostConfig({
      env: { XRK_SESSIONS_DIR: "  ./.xrk/sessions  " },
    });
    expect(cfg.runtime.sessionsDir).toBe("./.xrk/sessions");
  });

  it("parses Cursor mcpServers object JSON", () => {
    const cfg = loadHostConfig({
      env: {
        XRK_MCP_SERVERS: JSON.stringify({
          mcpServers: {
            demo: { command: "npx", args: ["-y", "demo-mcp"] },
          },
        }),
      },
    });
    expect(cfg.runtime.mcpServers).toEqual([
      { serverName: "demo", command: "npx", args: ["-y", "demo-mcp"] },
    ]);
  });
});

describe("resolveXrkHome", () => {
  it("honors XRK_HOME over default", () => {
    const home = resolveXrkHome({ XRK_HOME: "C:/tmp/xrk-home-test" });
    expect(home.replace(/\\/g, "/")).toMatch(/tmp\/xrk-home-test$/);
  });

  it("sessions dir sits under harness home", () => {
    const env = { XRK_HOME: path.join("C:", "tmp", "xrk-sess") };
    expect(defaultSessionsDir(env)).toBe(path.join(resolveXrkHome(env), "sessions"));
  });
});

describe("parseMcpServersValue", () => {
  it("accepts Face array and Cursor object", () => {
    expect(
      parseMcpServersValue([
        { serverName: "a", command: "npx", args: ["-y", "x"] },
      ]),
    ).toEqual([{ serverName: "a", command: "npx", args: ["-y", "x"] }]);
    expect(
      parseMcpServersJson(
        JSON.stringify({
          mcpServers: { demo: { command: "node", args: ["s.js"] } },
        }),
      ),
    ).toEqual([{ serverName: "demo", command: "node", args: ["s.js"] }]);
  });
});
