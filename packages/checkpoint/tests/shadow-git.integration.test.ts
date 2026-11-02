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
  checkpointIndexPath,
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

  it("keeps non-ASCII paths literal instead of C-style quotes", async () => {
    // `git clean -nd` escapes non-ASCII by default (`"\344\270\255…"`), which
    // is what a Chinese Windows / Japanese macOS / Linux workspace hits on
    // every restore preview. `core.quotepath=false` makes `extra` / `removed`
    // real paths.
    const ws = makeWorkspace();
    writeFileSync(path.join(ws, "a.txt"), "one\n", "utf8");
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    const record = await store.snapshot({ sessionId: "s", seq: 1 });

    const cjk = "中文 空格#1.txt";
    writeFileSync(path.join(ws, cjk), "x\n", "utf8");

    const plan = await store.planRestore(record.id);
    expect(plan.extra).toContain(cjk);

    const pruned = await store.restore(record.id, { prune: true });
    expect(pruned.removed).toContain(cjk);
    expect(existsSync(path.join(ws, cjk))).toBe(false);
  });

  it("keeps artifacts out of the snapshot and records what the cap skipped", async () => {
    // Why this test exists: the whole point of the gate is that a 9.5 GiB
    // workspace stops being snapshotted file-by-file, and that the *user* can
    // see what a rollback will not cover. Both halves are asserted here.
    const ws = makeWorkspace();
    const store = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit,
      // 1 KiB instead of the real 10 MiB so the test stays fast; the gate is
      // the same code path.
      maxFileBytes: 1024,
    });
    writeFileSync(path.join(ws, "src.ts"), "export const a = 1;\n", "utf8");
    writeFileSync(path.join(ws, "notes.md"), "# notes\n", "utf8");
    // Suffix gate: an archive and a raster image never enter the shadow repo.
    writeFileSync(path.join(ws, "bundle.zip"), Buffer.alloc(8, 7));
    writeFileSync(path.join(ws, "pixel.png"), Buffer.alloc(8, 7));
    // Byte cap: `.json` passes the suffix gate but is too big to snapshot.
    writeFileSync(path.join(ws, "big.json"), "x".repeat(4096), "utf8");

    const record = await store.snapshot({ sessionId: "s", seq: 1 });

    expect(record.fileCount).toBe(2); // src.ts + notes.md only
    expect(record.skippedOversized).toEqual(["big.json"]);

    // Excluded, not deleted: the artifacts are still in the worktree.
    for (const name of ["bundle.zip", "pixel.png", "big.json"]) {
      expect(existsSync(path.join(ws, name))).toBe(true);
    }

    // The restore preview admits the gap instead of implying full coverage.
    const plan = await store.planRestore(record.id);
    expect(plan.fileCount).toBe(2);
    expect(plan.skippedOversized).toEqual(["big.json"]);

    // `--prune` must not eat what the excludes hid — they are not "extra".
    const pruned = await store.restore(record.id, { prune: true });
    expect(pruned.removed).toEqual([]);
    for (const name of ["bundle.zip", "pixel.png", "big.json"]) {
      expect(existsSync(path.join(ws, name))).toBe(true);
    }
  });

  it("discards a shadow repo written under an older exclusion policy", async () => {
    // A policy bump is the only way down: the refused blobs are reachable from
    // HEAD, so `gc` never reclaims them. Rebuilding costs the old points, and
    // this test pins that trade-off (repo gone, index set aside, new repo works).
    const ws = makeWorkspace();
    writeFileSync(path.join(ws, "a.txt"), "one\n", "utf8");
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    const first = await store.snapshot({ sessionId: "s", seq: 1 });

    const checkpointDir = workspaceCheckpointDir(ws);
    const shadow = shadowGitDir(checkpointDir);
    // The policy marker sits beside `git/`, not inside it.
    const marker = path.join(checkpointDir, "policy");
    const index = checkpointIndexPath(checkpointDir);
    expect(readFileSync(marker, "utf8").trim()).toBe("2");
    expect(existsSync(index)).toBe(true);

    // Pretend a previous release wrote this repo.
    writeFileSync(marker, "1", "utf8");
    const reopened = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit });
    const second = await reopened.snapshot({ sessionId: "s", seq: 2 });

    expect(second.id).not.toBe(first.id);
    expect(second.fileCount).toBe(1);
    // The old commit is unreachable *and* absent — not merely pruned.
    const oldCommit = spawnSync("git", [
      "--git-dir",
      shadow,
      "cat-file",
      "-e",
      first.id,
    ]);
    expect(oldCommit.status).not.toBe(0);
    // The point list is renamed aside rather than deleted.
    expect(existsSync(`${index}.policy1.bak`)).toBe(true);
    expect(readFileSync(marker, "utf8").trim()).toBe("2");
  });

});
