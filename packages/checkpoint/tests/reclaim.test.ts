// Shadow-repo object reclamation.
//
// `maintenance.auto=false` keeps git from grabbing the object lock under a
// concurrent snapshot, which also means nothing packs the loose objects each
// `add -A` commit produces (a live shadow repo reached 27,828 loose objects /
// 12.79 GiB with zero packs). `reclaim()` is the explicit half of that trade.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceCheckpointStore,
  createProcessGitRunner,
} from "../src/index.js";

const temps: string[] = [];
let testHome = "";

beforeEach(() => {
  testHome = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-reclaim-home-"));
  temps.push(testHome);
  // Shadow repos live under XRK_HOME; never touch the operator's real one.
  vi.stubEnv("XRK_HOME", testHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceCheckpointStore.reclaim", () => {
  it("is a no-op while the loose-object count is below gc.auto", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-reclaim-ws-"));
    temps.push(ws);
    writeFileSync(path.join(ws, "a.txt"), "one\n");

    const store = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit: createProcessGitRunner(),
    });
    await store.snapshot({ sessionId: "s1", seq: 0 });

    // One commit's worth of loose objects: git's own threshold decides, so the
    // call reports "nothing packed" instead of repacking a tiny repo.
    expect(await store.reclaim()).toBe(false);
  });

  it("reports false instead of throwing when git cannot answer", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-reclaim-ws-"));
    temps.push(ws);
    const store = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit: async () => ({ code: -1, stdout: "", stderr: "git not found" }),
    });

    await expect(store.reclaim()).resolves.toBe(false);
  });
});
