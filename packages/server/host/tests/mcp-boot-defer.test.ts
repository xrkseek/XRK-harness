import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";
import {
  isolatedHostEnv,
  withIsolatedXrkHome,
} from "./helpers/isolated-xrk-home.js";

describe("host MCP boot deferral", () => {
  it("returns HTTP before a hanging MCP stdio handshake", async () => {
    await withIsolatedXrkHome(async (xrkHome) => {
      const manager = createHostManager();
      const hang = JSON.stringify({
        mcpServers: {
          hang: {
            command: process.execPath,
            args: ["-e", "setInterval(() => {}, 1e9)"],
          },
        },
      });
      const config = loadHostConfig({
        env: isolatedHostEnv(xrkHome, {
          XRK_API_KEY: "test-key",
          XRK_MCP_ALLOW: "1",
          XRK_MCP_SERVERS: hang,
        }),
        patch: {
          workspaceRoot: process.cwd(),
          listen: false,
          webDist: path.join(process.cwd(), "apps", "web", "dist"),
        },
      });
      const spawned = manager.spawn(
        config,
        async ({ sessionId, store, workspaceRoot, plugins }) => {
          const composition = createMinimalComposition({
            workspaceRoot,
            sessionStore: store,
            sessionId,
            plugins,
            llm: createReplayAdapter([{ content: "unused" }]),
            assemble: true,
          });
          return composition.createAgent();
        },
      );
      const instance = await Promise.race([
        spawned,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("spawn waited on MCP connect")),
            8_000,
          );
        }),
      ]);
      const health = await instance.http.fetch(
        new Request("http://desktop.local/health"),
      );
      expect(health.status).toBe(200);
      await manager.stopAll();
    });
  });
});
