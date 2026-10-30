/**
 * Listen-first optional warmup: sunflower (Bun + Kilo) and dsh-compat prewarm
 * must not delay HTTP bind when `listen: true` (DSH posture).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";
import {
  isolatedHostEnv,
  withIsolatedXrkHome,
} from "./helpers/isolated-xrk-home.js";

const ensureSunflower = vi.fn(async () => false);
const prewarm = vi.fn(async () => {});

vi.mock("@xrkseek/server-http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xrkseek/server-http")>();
  return {
    ...actual,
    ensureSunflowerFreePlugin: (...args: unknown[]) =>
      ensureSunflower(...args) as Promise<boolean>,
    prewarmDshCompatAdapters: (...args: unknown[]) =>
      prewarm(...args) as Promise<void>,
  };
});

afterEach(() => {
  ensureSunflower.mockReset();
  prewarm.mockReset();
  ensureSunflower.mockResolvedValue(false);
  prewarm.mockResolvedValue(undefined);
});

describe("host listen-first optional warmup", () => {
  it("binds HTTP before awaiting sunflower / dsh-compat prewarm", async () => {
    await withIsolatedXrkHome(async (xrkHome) => {
      let releaseWarmup!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseWarmup = resolve;
      });
      ensureSunflower.mockImplementation(async () => {
        await gate;
        return false;
      });
      prewarm.mockImplementation(async () => {
        await gate;
      });

      const manager = createHostManager();
      const config = loadHostConfig({
        env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "test-key" }),
        patch: {
          workspaceRoot: process.cwd(),
          listen: true,
          host: "127.0.0.1",
          port: 0,
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
            () => reject(new Error("spawn waited on optional warmup")),
            8_000,
          );
        }),
      ]);
      const port = instance.health().port;
      expect(typeof port).toBe("number");
      expect(port).toBeGreaterThan(0);
      // Warmup still pending — release so dispose can finish cleanly.
      releaseWarmup();
      await manager.stopAll();
    });
  });

  it("does not await sunflower on spawn when listen is disabled either", async () => {
    await withIsolatedXrkHome(async (xrkHome) => {
      let releaseWarmup!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseWarmup = resolve;
      });
      ensureSunflower.mockImplementation(async () => {
        await gate;
        return false;
      });
      prewarm.mockImplementation(async () => {
        await gate;
      });

      const manager = createHostManager();
      const config = loadHostConfig({
        env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "test-key" }),
        patch: {
          workspaceRoot: process.cwd(),
          listen: false,
          webDist: path.join(process.cwd(), "apps", "web", "dist"),
        },
      });
      const instance = await Promise.race([
        manager.spawn(
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
        ),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("spawn waited on optional warmup")),
            8_000,
          );
        }),
      ]);
      expect(
        await instance.http.fetch(new Request("http://desktop.local/health")),
      ).toMatchObject({ status: 200 });
      releaseWarmup();
      await manager.stopAll();
    });
  });
});

