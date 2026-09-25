import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceCheckpointStore,
  createProcessGitRunner,
  shadowGitDir,
  workspaceCheckpointDir,
} from "../src/index.js";

const runGit = createProcessGitRunner();
const gitAvailable = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
const maybe = gitAvailable ? describe : describe.skip;

const temps: string[] = [];

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-home-"));
  temps.push(testHome);
  // Sandbox the default checkpoint root (real git runs inherit XRK_HOME too,
  // which the store resolves for the shadow dir — harmless for `git`).
  vi.stubEnv("XRK_HOME", testHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-it-"));
  temps.push(dir);
  const ws = path.join(dir, "ws");
  mkdirSync(ws, { recursive: true });
  return ws;
}

maybe("workspace snapshots against real git", () => {
  it("records a recoverable point even when nothing changed", async () => {
    const ws = makeWorkspace();
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    const first = await store.snapshot({ sessionId: "s", seq: 0 });
    const second = await store.snapshot({ sessionId: "s", seq: 1 });

    expect(first.fileCount).toBe(0);
    expect(first.id).toMatch(/^[0-9a-f]{40}$/);
    // `--allow-empty`: a no-change turn is still a restore target.
    expect(second.id).not.toBe(first.id);
    expect(store.list()).toHaveLength(2);
  });

  it("never touches the operator's own repository", async () => {
    const ws = makeWorkspace();
    const init = await runGit(["init", "--quiet"], { cwd: ws });
    expect(init.code).toBe(0);
    const base = await runGit(
      [
        "-c",
        "user.email=t@example.test",
        "-c",
        "user.name=Test",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "base",
      ],
      { cwd: ws },
    );
    expect(base.code).toBe(0);
    const before = (await runGit(["rev-parse", "HEAD"], { cwd: ws })).stdout.trim();
    expect(before).not.toBe("");

    writeFileSync(path.join(ws, "a.txt"), "one\n", "utf8");
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    const record = await store.snapshot({ sessionId: "s1", seq: 1 });

    // Only the tracked file is captured — the shadow repo excludes itself.
    expect(record.fileCount).toBe(1);
    expect(existsSync(path.join(ws, ".git"))).toBe(true);
    expect(
      existsSync(path.join(shadowGitDir(workspaceCheckpointDir(ws)), "HEAD")),
    ).toBe(true);
    const after = (await runGit(["rev-parse", "HEAD"], { cwd: ws })).stdout.trim();
    expect(after).toBe(before);
    // Nothing is staged in the operator's index: the shadow commit lands in
    // the shadow repo only (which now lives under the isolated XRK home,
    // never inside the workspace).
    const staged = await runGit(["diff", "--cached", "--name-only"], { cwd: ws });
    expect(staged.stdout.trim()).toBe("");
  });

  it("restores content, keeps new files, and prunes only on request", async () => {
    const ws = makeWorkspace();
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    writeFileSync(path.join(ws, "a.txt"), "one\n", "utf8");
    const record = await store.snapshot({ sessionId: "s1", seq: 1 });

    // A turn mutates the file and leaves scratch behind.
    writeFileSync(path.join(ws, "a.txt"), "two\n", "utf8");
    writeFileSync(path.join(ws, "new.txt"), "scratch\n", "utf8");
    mkdirSync(path.join(ws, "scratch"), { recursive: true });
    writeFileSync(path.join(ws, "scratch", "nested.txt"), "nested\n", "utf8");

    const plan = await store.planRestore(record.id);
    expect(plan.fileCount).toBe(1);
    expect(plan.extra).toContain("new.txt");
    expect(plan.extra).toContain("scratch/");

    const restored = await store.restore(record.id);
    expect(restored.restored).toBe(1);
    expect(restored.removed).toEqual([]);
    expect(readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("one\n");
    expect(existsSync(path.join(ws, "new.txt"))).toBe(true);

    const pruned = await store.restore(record.id, { prune: true });
    expect(pruned.removed).toContain("new.txt");
    expect(existsSync(path.join(ws, "new.txt"))).toBe(false);
    expect(readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("one\n");
    // The shadow repo survived `clean -fd`.
    expect(
      existsSync(path.join(shadowGitDir(workspaceCheckpointDir(ws)), "HEAD")),
    ).toBe(true);
  });

  it("brings back a file deleted after the snapshot", async () => {
    const ws = makeWorkspace();
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    writeFileSync(path.join(ws, "keep.txt"), "hi\n", "utf8");
    const record = await store.snapshot({ sessionId: "s", seq: 1 });

    rmSync(path.join(ws, "keep.txt"));
    expect(existsSync(path.join(ws, "keep.txt"))).toBe(false);

    await store.restore(record.id);
    expect(readFileSync(path.join(ws, "keep.txt"), "utf8")).toBe("hi\n");
  });

});
