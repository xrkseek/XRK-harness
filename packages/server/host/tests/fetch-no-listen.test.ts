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

describe("host fetch without listen", () => {
  it("serves /health via http.fetch when listen is false", async () => {
    await withIsolatedXrkHome(async (xrkHome) => {
      const manager = createHostManager();
      const config = loadHostConfig({
        env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "test-key" }),
        patch: {
          workspaceRoot: process.cwd(),
          listen: false,
          webDist: path.join(process.cwd(), "apps", "web", "dist"),
        },
      });

      expect(config.runtime.listen).toBe(false);

      const instance = await manager.spawn(
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

      expect(instance.health().port).toBeUndefined();

      const health = await instance.http.fetch(
        new Request("http://desktop.local/health"),
      );
      expect(health.status).toBe(200);
      const body = (await health.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);

      await manager.stopAll();
    });
  });
});
