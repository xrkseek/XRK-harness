import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  SNAPSHOT_DRAIN_BUDGET_MS,
  clearWorkspaceCheckpointStores,
  setWorkspaceCheckpointGitRunner,
  snapshotSessionWorkspace,
} from "../src/workspace-checkpoint.js";
import type { FaceRuntime } from "../src/context.js";

describe("snapshotSessionWorkspace budget", () => {
  it("honors budgetMs instead of waiting out a slow git runner", async () => {
    clearWorkspaceCheckpointStores();
    setWorkspaceCheckpointGitRunner(async () => {
      await new Promise((r) => setTimeout(r, 8_000));
      return { code: 0, stdout: "", stderr: "" };
    });
    const cwd = await mkdtemp(path.join(tmpdir(), "xrk-snap-budget-"));
    try {
      const store = createMemorySessionStore();
      const session = store.create();
      const runtime = {
        store,
        workspaceRoot: cwd,
        sessionCwds: new Map([[session.id, cwd]]),
        workspaces: {
          workspaceIdOf: () => undefined,
          get: () => undefined,
        },
      } as unknown as FaceRuntime;
      const t0 = Date.now();
      const record = await snapshotSessionWorkspace(runtime, session.id, {
        budgetMs: SNAPSHOT_DRAIN_BUDGET_MS,
      });
      const elapsed = Date.now() - t0;
      expect(record).toBeUndefined();
      expect(elapsed).toBeLessThan(SNAPSHOT_DRAIN_BUDGET_MS + 2_000);
    } finally {
      setWorkspaceCheckpointGitRunner(undefined);
      clearWorkspaceCheckpointStores();
    }
  }, 15_000);
});
